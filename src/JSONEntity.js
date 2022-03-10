module.exports = class JSONEntity {

  /**
   * @param {import('./JSONStorage')} storage 
   * @param {string} type
   * @param {Object} data
   */
  constructor(storage, type, data) {
    this.storage = storage;
    this.type = type;
    this.data = data;
  }

  /** @returns {(number|null)} */
  get id() {
    return this.data && this.data.id || null;
  }

  /**
   * @returns {this}
   */
  save() {
    this.storage.save(this.type, this.data);
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
   * @param {number} index
   * @param {string} target
   * @returns {(JSONEntity|JSONEntity[]|null|string|number)}
   */
  get(field, index = null, target = null) {
    const ref = this.storage.getSchemaRefs(this.type).find(v => v.field === field);

    if (ref !== undefined) {
      let value = null;
      switch (ref.type) {
        case 'prop':
          value = this.data[field];
          break;
        case 'props':
          if (index === null) {
            value = this.data[field];
          } else {
            value = this.data[field][index];
          }
          break;
        case 'reference':
          if (typeof index === 'string' && target === null) {
            target = index;
            index = null;
          }
          
          if (index === null) {
            value = this.data[field].map(v => target && v[target] || v);
          } else {
            value = target && this.data[field][index][target] || this.data[field][index];
          }
          break;
      }

      let reference = ref.ref;
      if (ref.type === 'reference') {
        const target_info = ref.targets.find(v => v.target === target);
        if (target_info === undefined) return value;
        reference = target_info.ref;
      }

      if (Array.isArray(value)) {
        return value.map(v => this.storage.get(this.storage.getRefType(reference), v));
      } else {
        return this.storage.get(this.storage.getRefType(reference), value);
      }
    }
    return this.data[field];
  }

  /**
   * @param {string} field 
   * @param {any} value 
   * @returns {this}
   */
  set(field, value) {
    const result = this.storage.getValidator(this.type, field)(value);
    const errors = [];

    for (const error of result.errors) {
      errors.push(error.stack);
    }
    
    if (errors.length) throw new Error(errors.join('; '));
    this.data[field] = value;
    return this;
  }

}