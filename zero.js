module.exports = {

  /**
   * @param {import('zero-annotation')} parser 
   */
  service(parser) {
    parser.read(__dirname, 'src/**/*.js');
  }

}