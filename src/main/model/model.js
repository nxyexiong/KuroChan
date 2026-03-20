/**
 * model.js — Model facade. Runs in the main process.
 *
 * Manages the active model service and exposes a single public API.
 */
const { BuiltinModelService } = require('./builtin-model-service.js');

const SERVICES = {
  'builtin': BuiltinModelService,
};
const DEFAULT_SERVICE = 'builtin';

let service = new BuiltinModelService();

function configureModel(modelConfig) {
  const key = modelConfig?.service || DEFAULT_SERVICE;
  const ServiceClass = SERVICES[key] || SERVICES[DEFAULT_SERVICE];
  service = new ServiceClass();
}

function setBuiltinModelWindow(win) {
  return service.setBuiltinWindow(win);
}

function setMouthOpen(value) {
  return service.setMouthOpen(value);
}

module.exports = { configureModel, setBuiltinModelWindow, setMouthOpen };
