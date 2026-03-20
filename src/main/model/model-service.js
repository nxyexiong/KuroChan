/**
 * model-service.js — Base class for model backend services.
 *
 * Subclasses implement model-specific parameter control and
 * their own transport (local IPC, remote network, etc.).
 */
class ModelService {
  setMouthOpen(value) { throw new Error('ModelService.setMouthOpen() must be implemented'); }
}

module.exports = { ModelService };
