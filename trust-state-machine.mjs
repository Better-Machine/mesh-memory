/**
 * @module trust-state-machine
 * @description Trust level state machine for relational memory (L3)
 * Manages relationship progression: stranger → acquaintance → collaborator → partner
 * @version 1.0.0
 */

import { createLogger, generateCorrelationId } from './palace-logger.mjs';
import { PalaceError, ValidationError, safeExecute } from './palace-errors.mjs';

/**
 * Trust levels in order of increasing trust
 * @readonly
 * @enum {string}
 */
export const TrustLevel = {
  STRANGER: 'stranger',
  ACQUAINTANCE: 'acquaintance',
  COLLABORATOR: 'collaborator',
  PARTNER: 'partner'
};

/**
 * Trust level progression order
 * @private
 */
const TRUST_PROGRESSION = [
  TrustLevel.STRANGER,
  TrustLevel.ACQUAINTANCE,
  TrustLevel.COLLABORATOR,
  TrustLevel.PARTNER
];

/**
 * Valid state transitions
 * @private
 */
const VALID_TRANSITIONS = {
  [TrustLevel.STRANGER]: [TrustLevel.ACQUAINTANCE],
  [TrustLevel.ACQUAINTANCE]: [TrustLevel.STRANGER, TrustLevel.COLLABORATOR],
  [TrustLevel.COLLABORATOR]: [TrustLevel.ACQUAINTANCE, TrustLevel.PARTNER],
  [TrustLevel.PARTNER]: [TrustLevel.COLLABORATOR]
};

/**
 * Trust level metadata (thresholds, descriptions)
 * @private
 */
const TRUST_METADATA = {
  [TrustLevel.STRANGER]: {
    minInteractions: 0,
    minPositiveRatio: 0,
    description: 'No established relationship. Default state for new agent pairs.',
    canShare: ['public'],
    requiresExplicitConsent: true
  },
  [TrustLevel.ACQUAINTANCE]: {
    minInteractions: 3,
    minPositiveRatio: 0.5,
    description: 'Basic familiarity established through repeated interactions.',
    canShare: ['public', 'identity'],
    requiresExplicitConsent: true
  },
  [TrustLevel.COLLABORATOR]: {
    minInteractions: 10,
    minPositiveRatio: 0.7,
    description: 'Active working relationship with history of successful collaboration.',
    canShare: ['public', 'identity', 'contextual'],
    requiresExplicitConsent: false
  },
  [TrustLevel.PARTNER]: {
    minInteractions: 25,
    minPositiveRatio: 0.8,
    description: 'Deep trust relationship. Implicit consent for most shared operations.',
    canShare: ['public', 'identity', 'contextual', 'private'],
    requiresExplicitConsent: false
  }
};

/**
 * TrustStateMachine class
 * Manages trust level transitions and validation
 */
export class TrustStateMachine {
  /**
   * Create a new TrustStateMachine instance
   * @param {Object} options - Configuration options
   * @param {string} options.correlationId - Correlation ID for tracing
   */
  constructor(options = {}) {
    this.correlationId = options.correlationId || generateCorrelationId();
    this.logger = createLogger({}, this.correlationId)
      .child({ module: 'trust-state-machine' });
  }

  /**
   * Validate trust level string
   * @param {string} level - Trust level to validate
   * @returns {boolean}
   */
  isValidLevel(level) {
    return Object.values(TrustLevel).includes(level);
  }

  /**
   * Get numeric index of trust level (for comparison)
   * @param {string} level - Trust level
   * @returns {number} Index in progression (0 = stranger, 3 = partner)
   * @throws {ValidationError} If level is invalid
   */
  getLevelIndex(level) {
    const index = TRUST_PROGRESSION.indexOf(level);
    if (index === -1) {
      throw ValidationError.field('trustLevel', level, {
        allowed: Object.values(TrustLevel),
        correlationId: this.correlationId
      });
    }
    return index;
  }

  /**
   * Check if a transition is valid
   * @param {string} fromLevel - Current trust level
   * @param {string} toLevel - Target trust level
   * @returns {boolean}
   */
  canTransition(fromLevel, toLevel) {
    if (!this.isValidLevel(fromLevel) || !this.isValidLevel(toLevel)) {
      return false;
    }
    if (fromLevel === toLevel) return true; // Same level is always valid
    const validTargets = VALID_TRANSITIONS[fromLevel] || [];
    return validTargets.includes(toLevel);
  }

  /**
   * Attempt a trust level transition
   * @param {string} fromLevel - Current trust level
   * @param {string} toLevel - Target trust level
   * @param {Object} context - Additional context for the transition
   * @returns {Object} { success: boolean, newLevel: string, reason?: string }
   */
  transition(fromLevel, toLevel, context = {}) {
    return safeExecute(() => {
      this.logger.debug('Attempting trust transition', { 
        from: fromLevel, 
        to: toLevel,
        context: Object.keys(context)
      });

      // Validate levels
      if (!this.isValidLevel(fromLevel)) {
        throw ValidationError.field('fromLevel', fromLevel, {
          allowed: Object.values(TrustLevel),
          correlationId: this.correlationId
        });
      }
      if (!this.isValidLevel(toLevel)) {
        throw ValidationError.field('toLevel', toLevel, {
          allowed: Object.values(TrustLevel),
          correlationId: this.correlationId
        });
      }

      // Check if transition is valid
      if (!this.canTransition(fromLevel, toLevel)) {
        const validTargets = VALID_TRANSITIONS[fromLevel] || [];
        return {
          success: false,
          newLevel: fromLevel,
          reason: `Invalid transition from ${fromLevel} to ${toLevel}. Valid targets: ${validTargets.join(', ') || 'none'}`
        };
      }

      // Same level is always successful
      if (fromLevel === toLevel) {
        return {
          success: true,
          newLevel: fromLevel,
          reason: 'No change needed - already at target level'
        };
      }

      // Log successful transition
      this.logger.info('Trust level transitioned', {
        from: fromLevel,
        to: toLevel,
        agentPair: context.agentPairHash
      });

      return {
        success: true,
        newLevel: toLevel,
        reason: `Transitioned from ${fromLevel} to ${toLevel}`,
        timestamp: new Date().toISOString()
      };
    }, { 
      operation: 'trustTransition',
      correlationId: this.correlationId 
    });
  }

  /**
   * Get trust level metadata
   * @param {string} level - Trust level
   * @returns {Object} Metadata for the level
   */
  getMetadata(level) {
    if (!this.isValidLevel(level)) {
      throw ValidationError.field('level', level, {
        allowed: Object.values(TrustLevel),
        correlationId: this.correlationId
      });
    }
    return {
      level,
      ...TRUST_METADATA[level]
    };
  }

  /**
   * Compare two trust levels
   * @param {string} levelA - First trust level
   * @param {string} levelB - Second trust level
   * @returns {number} Negative if A < B, 0 if equal, positive if A > B
   */
  compareLevels(levelA, levelB) {
    const indexA = this.getLevelIndex(levelA);
    const indexB = this.getLevelIndex(levelB);
    return indexA - indexB;
  }

  /**
   * Check if levelA has at least as much trust as levelB
   * @param {string} levelA - Trust level to check
   * @param {string} levelB - Minimum trust level required
   * @returns {boolean}
   */
  hasMinimumTrust(levelA, levelB) {
    return this.compareLevels(levelA, levelB) >= 0;
  }

  /**
   * Calculate trust level based on interaction metrics
   * @param {Object} metrics - Interaction metrics
   * @param {number} metrics.totalInteractions - Total number of interactions
   * @param {number} metrics.positiveInteractions - Number of positive interactions
   * @param {number} metrics.negativeInteractions - Number of negative interactions
   * @returns {string} Recommended trust level
   */
  calculateFromMetrics(metrics = {}) {
    const { totalInteractions = 0, positiveInteractions = 0 } = metrics;
    
    if (totalInteractions === 0) {
      return TrustLevel.STRANGER;
    }

    const positiveRatio = totalInteractions > 0 ? positiveInteractions / totalInteractions : 0;

    // Check thresholds from highest to lowest
    if (totalInteractions >= TRUST_METADATA[TrustLevel.PARTNER].minInteractions &&
        positiveRatio >= TRUST_METADATA[TrustLevel.PARTNER].minPositiveRatio) {
      return TrustLevel.PARTNER;
    }

    if (totalInteractions >= TRUST_METADATA[TrustLevel.COLLABORATOR].minInteractions &&
        positiveRatio >= TRUST_METADATA[TrustLevel.COLLABORATOR].minPositiveRatio) {
      return TrustLevel.COLLABORATOR;
    }

    if (totalInteractions >= TRUST_METADATA[TrustLevel.ACQUAINTANCE].minInteractions &&
        positiveRatio >= TRUST_METADATA[TrustLevel.ACQUAINTANCE].minPositiveRatio) {
      return TrustLevel.ACQUAINTANCE;
    }

    return TrustLevel.STRANGER;
  }

  /**
   * Get all valid transitions from a given level
   * @param {string} level - Current trust level
   * @returns {string[]} Valid target levels
   */
  getValidTransitions(level) {
    if (!this.isValidLevel(level)) {
      return [];
    }
    return [level, ...(VALID_TRANSITIONS[level] || [])];
  }
}

/**
 * Create a new TrustStateMachine instance (factory function)
 * @param {Object} options - Configuration options
 * @returns {TrustStateMachine}
 */
export function createTrustStateMachine(options = {}) {
  return new TrustStateMachine(options);
}

// Export default for convenience
export default TrustStateMachine;
