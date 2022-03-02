const Path = require('path');
const FS = require('fs');
const Validator = require('jsonschema').Validator;
const FileUtil = require('pencl-kit/src/Util/FileUtil');
const JSONEntity = require('./JSONEntity');

/**
 * @service (storage.json)
 */
module.exports = class JSONStorage {

  /**
   * @param {import('../types').T_JSONStorageConfig} config
   */
  constructor(config = {}) {
    this._config = config;
    this._schemas = null;

    if (config.schema && FS.existsSync(config.schema) && FS.statSync(config.schema).isDirectory()) {
      for (const file of FS.readdirSync(config.schema)) {
        const dataschema = require(Path.join(config.schema, file));
        this.addSchema(dataschema.type, dataschema.schema);
      }
    }
  }

  /** @returns {import('../types').T_JSONStorageConfig} */
  get config() {
    return this._config;
  }

  /** @returns {Object[]} */
  get schemas() {
    if (this._schemas === null) {
      this._schemas = {};
    }
    return this._schemas;
  }

  /**
   * @param {string} type 
   * @param {Object} entity 
   * @returns {Object}
   */
  cut(type, entity) {
    const refs = this.getSchemaRefs(type);
    const fields = this.getSchemaFields(type);

    for (const field in entity) {
      if (typeof fields[field] !== 'string' && typeof refs[field] !== 'string') {
        delete entity[field];
      }
      if (typeof refs[field] === 'string' && entity[field] && typeof entity[field] !== 'number') {
        entity[field] = this.cut(refs[field], entity[field]);
      }
    }
    return entity;
  }

  /**
   * @param {string} type 
   * @returns {JSONEntity}
   */
  get(type) {
    return new JSONEntity(this, type);
  }

  /**
   * @param {string} type 
   * @param {(import('../types').C_StorageFilter|null)} predicate 
   * @returns {JSONEntity[]}
   */
  search(type, predicate = null) {
    const file = this.getDataFile(type);
    let value = {id: 0, data: []};
    if (FS.existsSync(file)) {
      value = require(file);
    }
    if (predicate === null) return value.data.map(data => new JSONEntity(this, type, data));
    return value.data.filter((data, index, list) => {
      return predicate(new JSONEntity(this, type, data), index, list);
    }).map(data => new JSONEntity(this, type, data));
  }

  /**
   * @param {string} type 
   * @returns {string}
   */
  getDataFile(type) {
    return Path.join(this.config.path, type + '.json');
  }

  /**
   * @param {string} type 
   * @returns {Function}
   */
  getValidator(type) {
    const validator = new Validator();

    for (const name in this.schemas) {
      validator.addSchema({
        id: '/' + name,
        type: ['object', 'number'],
        properties: this.schemas[name].fields,
        additionalProperties: false,
      }, '/' + name);
    }
    return (entity) => {
      return validator.validate(entity, {
        id: '/' + type,
        type: ['object', 'number'],
        properties: this.getSchema(type).fields,
        additionalProperties: false,
      });
    };
  }

  /**
   * @param {string} type 
   * @param {Object} schema 
   * @returns {this}
   */
  addSchema(type, schema) {
    schema.fields.id = { type: 'number' };
    this.schemas[type] = schema;
    return this;
  }

  /**
   * @param {string} type 
   * @returns {(Object|null)}
   */
  getSchema(type) {
    return this.schemas[type] || null;
  }

  /**
   * @param {string} type 
   * @returns {Object<string, string>}
   */
  getSchemaFields(type) {
    const schema = this.getSchema(type);
    const fields = {};
    for (const field in schema.fields) {
      if (typeof schema.fields[field].type === 'string') {
        fields[field] = schema.fields[field].type;
      }
    }
    return fields;
  }

  /**
   * @param {string} type 
   * @returns {Object<string, string>}
   */
  getSchemaRefs(type) {
    const schema = this.getSchema(type);
    const refs = {};
    for (const field in schema.fields) {
      if (typeof schema.fields[field].$ref === 'string') {
        refs[field] = schema.fields[field].$ref.substring(1);
      }
    }
    return refs;
  }

  /**
   * @param {string} type 
   * @param {number} id 
   * @param {boolean} recursive 
   * @returns {this}
   */
  delete(type, id, recursive = false) {
    if (recursive) {
      const entity = this.load(type, id);
      if (!entity) return this;
      const refs = this.getSchemaRefs(type);
      for (const ref in refs) {
        if (typeof entity[ref] === 'number') {
          this.delete(refs[ref], entity[ref], true);
        } else if (entity[ref] !== null && entity[ref] !== undefined && typeof entity[ref] === 'object') {
          this.delete(refs[ref], entity[ref].id, true);
        }
      }
    }
    const file = this.getDataFile(type);
    let value = {id: 0, data: []};
    if (FS.existsSync(file)) {
      value = require(file);
    }
    const index = value.data.findIndex(v => v.id === id);
    if (index === -1) return this;
    value.data.splice(index, 1);
    FS.writeFileSync(file, this.toJSON(value));
    return this;
  }

  /**
   * @param {string} type 
   * @param {number} id 
   * @returns {Object}
   */
  load(type, id) {
    const file = this.getDataFile(type);
    let value = {id: 0, data: []};
    if (FS.existsSync(file)) {
      value = require(file);
    }
    return value.data.find(v => v.id === id);
  }

  /**
   * @param {string} type 
   * @param {Object} entity 
   * @returns {this}
   */
  save(type, entity) {
    this.validate(type, entity);

    const file = this.getDataFile(type);
    FileUtil.prepareDir('', file);

    const refs = this.getSchemaRefs(type);
    for (const ref in refs) {
      if (typeof entity[ref] !== 'number' && entity[ref] !== undefined && entity[ref] !== null) {
        this.save(refs[ref], entity[ref]);
        entity[ref] = entity[ref].id;
      }
    }

    if (entity.id) {
      this.doUpdate(file, entity);
    } else {
      this.doCreate(file, entity);
    }

    return this;
  }

  /**
   * @private
   * @param {string} file 
   * @param {Object} entity 
   * @returns {this}
   */
  doUpdate(file, entity) {
    let value = {id: 0, data: []};
    if (FS.existsSync(file)) {
      value = require(file);
    }
    const index = value.data.findIndex(v => v.id === entity.id);
    if (index === -1) {
      value.data.push(entity);
    } else {
      value.data[index] = entity;
    }
    if (value.id < entity.id) value.id = entity.id;
    FS.writeFileSync(file, this.toJSON(value));
    return this;
  }

  /**
   * @private
   * @param {string} file 
   * @param {Object} entity 
   * @returns {this}
   */
  doCreate(file, entity) {
    let value = {id: 0, data: []};
    if (FS.existsSync(file)) {
      value = require(file);
    }
    entity.id = ++value.id;
    value.data.push(entity);
    FS.writeFileSync(file, this.toJSON(value));
    return this;
  }

  /**
   * @param {string} type 
   * @param {Object} entity 
   * @param {boolean} throwing 
   * @returns {(import('jsonschema').ValidatorResult|boolean)}
   */
  validate(type, entity, throwing = true) {
    const result = this.getValidator(type)(entity);
    const errors = [];

    for (const error of result.errors) {
      errors.push(error.stack);
    }
    
    if (errors.length) {
      if (throwing) throw new Error(errors.join('; '));
      return result;
    }
    return true;
  }

  /**
   * @param {Object} value 
   * @returns {string}
   */
  toJSON(value) {
    if (this._config.debug) {
      return JSON.stringify(value, null, '  ');
    } else {
      return JSON.stringify(value);
    }
  }

}