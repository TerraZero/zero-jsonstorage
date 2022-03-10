const Path = require('path');
const FS = require('fs');
const Validator = require('jsonschema').Validator;
const FileUtil = require('pencl-kit/src/Util/FileUtil');
const JSONEntity = require('./JSONEntity');

/**
 * @service (storage.json)
 */
module.exports = class JSONStorage {

  constructor() {
    this._config = null;
    this._schemas = null;
    
    this._refs = {};
    this._defsSchema = null;
  }

  /**
   * @param {import('../types').T_JSONStorageConfig} config
   */
  setConfig(config = {}) {
    this._config = config;

    if (config.schema && FS.existsSync(config.schema) && FS.statSync(config.schema).isDirectory()) {
      for (const file of FS.readdirSync(config.schema)) {
        if (!file.endsWith('.schema.json')) continue;
        const name = file.substring(0, file.length - '.schema.json'.length).toLowerCase();
        const dataschema = require(Path.join(config.schema, file));

        this.addSchema(name, dataschema);
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
   * @returns {Object[]}
   */
  getSchemaRefs(type) {
    if (this._refs[type] === undefined) {
      this._refs[type] = [];
      const schema = this.getSchema(type);

      for (const field in schema.properties) {
        if (schema.properties[field].$ref) {
          this._refs[type].push({
            type: 'prop',
            field: field,
            ref: schema.properties[field].$ref,
          });
        } else if (schema.properties[field].type === 'array') {
          if (schema.properties[field].items.$ref) {
            this._refs[type].push({
              type: 'props',
              field: field,
              ref: schema.properties[field].items.$ref,
            });
          } else if (schema.properties[field].items.type === 'object') {
            for (const value_field in schema.properties[field].items.properties) {
              if (schema.properties[field].items.properties[value_field].$ref) {
                let reference = this._refs[type].find(v => v.field === field);
                if (reference === undefined) {
                  this._refs[type].push({
                    type: 'reference',
                    field: field,
                    targets: [
                      {
                        target: value_field,
                        ref: schema.properties[field].items.properties[value_field].$ref,
                      },
                    ],
                  });
                } else {
                  reference.targets.push({
                    target: value_field,
                    ref: schema.properties[field].items.properties[value_field].$ref,
                  });
                }
              }
            }
          }
        }
      }
    }
    return this._refs[type];
  }

  /**
   * @param {string} type 
   * @param {(number|Object)} idData
   * @returns {JSONEntity}
   */
  get(type, idData) {
    if (typeof idData === 'number') {
      return new JSONEntity(this, type, this.load(type, idData));
    } else {
      this.validate(type, idData, true);
      return new JSONEntity(this, type, idData);
    }
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

  getDefsSchema() {
    if (this._defsSchema === null) {
      this._defsSchema = {};
      for (const name in this.schemas) {
        this._defsSchema[name] = JSON.parse(JSON.stringify(this.schemas[name]));
        this._defsSchema[name].type = ['object', 'number'];
      }
    }
    return this._defsSchema;
  }

  /**
   * @param {string} type 
   * @param {string} field
   * @returns {Function}
   */
  getValidator(type, field = null) {
    const validator = new Validator();
    let schema = this.getSchema(type);

    if (field !== null) {
      schema = schema.properties[field];
    }
    schema.$defs = this.getDefsSchema();
    return (data) => {
      return validator.validate(data, schema);
    };
  }

  /**
   * @param {string} type 
   * @param {Object} schema 
   * @returns {this}
   */
  addSchema(type, schema) {
    schema.type = ['object', 'number'];
    schema.properties.id = { type: 'number' };
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
   * @param {number} id 
   * @param {boolean} recursive 
   * @returns {this}
   */
  delete(type, id, recursive = false) {
    if (recursive) {
      this.mapRefs(type, this.load(type, id), (value, index, ref) => {
        if (typeof value === 'number') {
          this.delete(this.getRefType(ref.ref), value, true);
        } else {
          this.delete(this.getRefType(ref.ref), value.id, true);
        }
      });
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
   * @returns {(Object|null)}
   */
  load(type, id) {
    const file = this.getDataFile(type);
    let value = {id: 0, data: []};
    if (FS.existsSync(file)) {
      value = require(file);
    }
    return value.data.find(v => v.id === id) || null;
  }

  mapRefs(type, data, mapper, references = null) {
    const refs = references || this.getSchemaRefs(type);

    for (const ref of refs) {
      if (data[ref.field] === null || data[ref.field] === undefined) {
        delete data[ref.field];
        continue;
      }
      switch (ref.type) {
        case 'prop':
          data[ref.field] = mapper(data[ref.field], null, ref);
          break;
        case 'props':
          for (const index in data[ref.field]) {
            data[ref.field][index] = mapper(data[ref.field][index], index, ref);
          }
          break;
        case 'reference':
          for (const index in data[ref.field]) {
            for (const target of ref.targets) {
              data[ref.field][index][target.target] = mapper(data[ref.field][index][target.target], index, {field: ref.field, type: ref.type, ref: target.ref, target: target.target});
            }
          }
          break;
      }
    }
  }

  /**
   * @param {string} ref 
   * @returns {string}
   */
  getRefType(ref) {
    return ref.split('/').pop();
  }

  /**
   * @param {string} type
   * @param {Object} data 
   * @returns {this}
   */
  save(type, data = null) {
    this.validate(type, data);

    this.mapRefs(type, data, (value, index, ref) => {
      if (typeof value === 'number') return value;
      this.save(this.getRefType(ref.ref), value);
      return value.id;
    });

    const file = this.getDataFile(type);
    FileUtil.prepareDir('', file);

    if (data.id) {
      this.doUpdate(file, data);
    } else {
      this.doCreate(file, data);
    }

    return this;
  }

  /**
   * @private
   * @param {string} file 
   * @param {Object} data 
   * @returns {this}
   */
  doUpdate(file, data) {
    let value = {id: 0, data: []};
    if (FS.existsSync(file)) {
      value = require(file);
    }
    const index = value.data.findIndex(v => v.id === data.id);
    if (index === -1) {
      value.data.push(data);
    } else {
      value.data[index] = data;
    }
    if (value.id < data.id) value.id = data.id;
    FS.writeFileSync(file, this.toJSON(value));
    return this;
  }

  /**
   * @private
   * @param {string} file 
   * @param {Object} data 
   * @returns {this}
   */
  doCreate(file, data) {
    let value = {id: 0, data: []};
    if (FS.existsSync(file)) {
      value = require(file);
    }
    data.id = ++value.id;
    value.data.push(data);
    FS.writeFileSync(file, this.toJSON(value));
    return this;
  }

  /**
   * @param {string} type 
   * @param {Object} data 
   * @param {boolean} throwing 
   * @returns {(import('jsonschema').ValidatorResult|boolean)}
   */
  validate(type, data, throwing = true) {
    const result = this.getValidator(type)(data);
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