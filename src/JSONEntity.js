const Validator = require('jsonschema').Validator;

module.exports = class JSONEntity {

  /**
   * @param {import('./JSONStorage')} storage 
   * @param {string} type
   * @param {Object} data
   */
  constructor(storage, type, data = null) {
    this.storage = storage;
    this.type = type;
    this.data = data;

    this._refs = null;
    this._fields = null;
    this._entities = {};
    this._validator = new Validator();
  }

  /** @returns {(number|null)} */
  get id() {
    return this.data && this.data.id || null;
  }

  /** @returns {Object<string, string>} */
  get refs() {
    if (this._refs === null) {
      this._refs = this.storage.getSchemaRefs(this.type);
    }
    return this._refs;
  }

  /** @returns {Object<string, string>} */
  get fields() {
    if (this._fields === null) {
      this._fields = this.storage.getSchemaFields(this.type);
    }
    return this._fields;
  }

  /**
   * @param {number} id 
   * @returns {this}
   */
  load(id) {
    this.data = this.storage.load(this.type, id);
    return this;
  }

  /**
   * @returns {this}
   */
  save() {
    this.storage.save(this.type, this.data);
    return this;
  }

  /**
   * @param {Object} data 
   * @returns {this}
   */
  create(data) {
    this.storage.validate(this.type, data);
    this.data = data;
    this._entities = {};
    return this;
  }

  /**
   * @param {boolean} recursive 
   * @returns {this}
   */
  delete(recursive = false) {
    this.storage.delete(this.type, this.id, recursive);
    return this;
  }

  /**
   * @param {string} field 
   * @returns {(JSONEntity|null|string|number)}
   */
  get(field) {
    if (typeof this.refs[field] === 'string') {
      if (this._entities[field]) return this._entities[field];
      if (typeof this.data[field] === 'number') {
        this.data[field] = this.storage.load(this.refs[field], this.data[field]);
      }
      if (this.data[field] === null || this.data[field] === undefined) return null;
      this._entities[field] = new JSONEntity(this.storage, this.refs[field], this.data[field]);
      return this._entities[field];
    }
    return this.data[field] || null;
  }

  /**
   * @param {string} field 
   * @param {any} value 
   * @returns {this}
   */
  set(field, value) {
    if (typeof this.fields[field] === 'string') {
      const result = this._validator.validate(value, this.storage.getSchema(this.type).fields[field]);
      const errors = [];

      for (const error of result.errors) {
        errors.push(error.stack);
      }
      
      if (errors.length) throw new Error(errors.join('; '));
    } else if (typeof this.refs[field] === 'string') {
      this.storage.validate(this.refs[field], value);
    } else {
      throw new Error('Unknown field "' + field + '" in schema "' + this.type + '"');
    }

    this.data[field] = value;
    return this;
  }

}