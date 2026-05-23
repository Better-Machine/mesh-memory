/**
 * A2A Bridge for mesh-memory
 * Translates A2A v1.0 protocol to Palace/Gatehouse APIs
 * 
 * @module a2a-bridge
 * @version 1.0.0
 */

import { randomUUID } from 'crypto';

/**
 * A2A Bridge class - translates A2A protocol to mesh-memory operations
 */
export class A2ABridge {
  constructor(options = {}) {
    this.loader = options.loader; // Palace CriticalFactsLoader
    this.gatehouseUrl = options.gatehouseUrl || 'http://localhost:18811';
    this.agentCard = options.agentCard || null;
    this.logger = options.logger || console;
    
    // Task state management
    this.tasks = new Map(); // taskId -> task state
    this.subscriptions = new Map(); // taskId -> subscription callbacks
    
    // A2A to mesh-memory skill mapping
    this.skillHandlers = {
      'palace-memory-l1': this.handleL1Query.bind(this),
      'palace-memory-l2': this.handleL2Search.bind(this),
      'palace-memory-l3': this.handleL3Temporal.bind(this),
      'palace-memory-l4': this.handleL4Kingdom.bind(this),
      'gatehouse-deals': this.handleGatehouseDeals.bind(this)
    };
  }

  /**
   * Handle A2A tasks/send request
   * Creates a new task and executes the appropriate mesh-memory operation
   */
  async handleSendTask(request) {
    const { message, skillId, parentId } = request;
    
    // Generate task ID
    const taskId = randomUUID();
    const now = new Date().toISOString();
    
    // Create task state
    const task = {
      id: taskId,
      parentId: parentId || null,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
      messages: [{
        role: 'user',
        parts: [{ text: message.text || message }]
      }],
      artifacts: [],
      metadata: {
        skillId,
        source: 'a2a-bridge'
      }
    };
    
    this.tasks.set(taskId, task);
    
    // Execute asynchronously
    this.executeTask(taskId, skillId, message);
    
    return {
      id: taskId,
      status: 'submitted',
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Execute task asynchronously
   */
  async executeTask(taskId, skillId, message) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    
    try {
      task.status = 'working';
      task.updatedAt = new Date().toISOString();
      
      // Find appropriate handler
      const handler = this.skillHandlers[skillId] || this.handleDefault.bind(this);
      
      // Execute mesh-memory operation
      const result = await handler(message, task);
      
      // Update task with result
      task.status = 'completed';
      task.updatedAt = new Date().toISOString();
      task.artifacts.push({
        type: 'text',
        text: result
      });
      
      // Notify subscribers
      this.notifySubscribers(taskId, task);
      
    } catch (error) {
      this.logger.error('Task execution failed', { taskId, error: error.message });
      
      task.status = 'failed';
      task.updatedAt = new Date().toISOString();
      task.metadata.error = error.message;
      
      this.notifySubscribers(taskId, task);
    }
  }

  /**
   * Handle L1 Critical Facts query
   */
  async handleL1Query(message, task) {
    if (!this.loader) {
      throw new Error('Palace loader not available');
    }
    
    const query = message.text || message;
    
    // Generate wake-up context (L1 facts)
    const result = await this.loader.generateWakeUpContext();
    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to retrieve L1 facts');
    }
    
    const context = result.data;
    
    // Format response
    return JSON.stringify({
      layer: 'L1',
      facts: context.facts || [],
      tokenCount: context.tokenCount || 0,
      source: 'palace-critical-facts',
      query: query
    }, null, 2);
  }

  /**
   * Handle L2 Deep Memory search
   */
  async handleL2Search(message, task) {
    if (!this.loader || !this.loader.db) {
      throw new Error('Palace database not available');
    }
    
    const query = message.text || message;
    
    // Search facts using FTS5
    const searchResults = this.loader.db.prepare(`
      SELECT * FROM critical_facts 
      WHERE value MATCH ? 
      ORDER BY rank 
      LIMIT 10
    `).all(query);
    
    return JSON.stringify({
      layer: 'L2',
      results: searchResults,
      count: searchResults.length,
      source: 'palace-deep-memory',
      query: query
    }, null, 2);
  }

  /**
   * Handle L3 Temporal Knowledge Graph queries
   */
  async handleL3Temporal(message, task) {
    // This would integrate with palace-tkg.mjs
    // For now, return stub
    return JSON.stringify({
      layer: 'L3',
      status: 'temporal-kg-not-fully-implemented',
      note: 'L3 Temporal KG requires additional integration',
      query: message.text || message
    }, null, 2);
  }

  /**
   * Handle L4 Kingdom multi-agent coordination
   */
  async handleL4Kingdom(message, task) {
    // This would integrate with palace-kingdom.mjs
    return JSON.stringify({
      layer: 'L4',
      status: 'kingdom-coordination',
      note: 'L4 Kingdom multi-agent coordination',
      query: message.text || message
    }, null, 2);
  }

  /**
   * Handle Gatehouse deals/negotiation
   */
  async handleGatehouseDeals(message, task) {
    // Parse deal request
    const text = message.text || message;
    
    // Check if this is a deal creation or query
    if (text.toLowerCase().includes('create deal') || text.toLowerCase().includes('propose')) {
      return await this.createDeal(message, task);
    }
    
    if (text.toLowerCase().includes('approve') || text.toLowerCase().includes('reject')) {
      return await this.handleDealAction(message, task);
    }
    
    // Default: list pending deals
    return await this.listDeals();
  }

  /**
   * Create a new deal via Gatehouse API
   */
  async createDeal(message, task) {
    try {
      const response = await fetch(`${this.gatehouseUrl}/deals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initiator: 'a2a-bridge',
          recipient: message.recipient || 'agent-liz',
          payload: { text: message.text },
          conditions: {
            requiredApprovals: ['agent-liz']
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`Gatehouse API error: ${response.status}`);
      }
      
      const result = await response.json();
      return JSON.stringify({
        action: 'deal-created',
        dealId: result.data?.dealId,
        status: result.data?.status,
        source: 'gatehouse'
      }, null, 2);
      
    } catch (error) {
      throw new Error(`Failed to create deal: ${error.message}`);
    }
  }

  /**
   * Handle deal approval/rejection
   */
  async handleDealAction(message, task) {
    // Extract deal ID from message or task context
    const dealId = message.dealId || task.metadata?.lastDealId;
    const action = message.text?.toLowerCase().includes('approve') ? 'approve' : 'reject';
    
    if (!dealId) {
      return JSON.stringify({ error: 'No deal ID provided' }, null, 2);
    }
    
    try {
      const response = await fetch(`${this.gatehouseUrl}/deals/${dealId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'a2a-bridge',
          action: action
        })
      });
      
      const result = await response.json();
      return JSON.stringify({
        action: `deal-${action}d`,
        dealId: dealId,
        status: result.data?.status,
        source: 'gatehouse'
      }, null, 2);
      
    } catch (error) {
      throw new Error(`Failed to ${action} deal: ${error.message}`);
    }
  }

  /**
   * List pending deals
   */
  async listDeals() {
    try {
      const response = await fetch(`${this.gatehouseUrl}/deals`);
      const result = await response.json();
      
      return JSON.stringify({
        deals: result.data || [],
        count: result.data?.length || 0,
        source: 'gatehouse'
      }, null, 2);
      
    } catch (error) {
      throw new Error(`Failed to list deals: ${error.message}`);
    }
  }

  /**
   * Default handler for unknown skills
   */
  async handleDefault(message, task) {
    return JSON.stringify({
      status: 'unknown-skill',
      availableSkills: Object.keys(this.skillHandlers),
      message: 'Unknown skill requested. Use one of the available skills.',
      query: message.text || message
    }, null, 2);
  }

  /**
   * Get task status
   */
  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  /**
   * Subscribe to task updates (for streaming)
   */
  subscribe(taskId, callback) {
    if (!this.subscriptions.has(taskId)) {
      this.subscriptions.set(taskId, []);
    }
    this.subscriptions.get(taskId).push(callback);
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.subscriptions.get(taskId);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Notify subscribers of task update
   */
  notifySubscribers(taskId, task) {
    const callbacks = this.subscriptions.get(taskId);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(task);
        } catch (err) {
          this.logger.error('Subscriber callback failed', { error: err.message });
        }
      });
    }
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'canceled';
      task.updatedAt = new Date().toISOString();
      this.notifySubscribers(taskId, task);
      return true;
    }
    return false;
  }

  /**
   * Get bridge statistics
   */
  getStats() {
    const tasks = Array.from(this.tasks.values());
    return {
      totalTasks: tasks.length,
      byStatus: {
        submitted: tasks.filter(t => t.status === 'submitted').length,
        working: tasks.filter(t => t.status === 'working').length,
        completed: tasks.filter(t => t.status === 'completed').length,
        failed: tasks.filter(t => t.status === 'failed').length,
        canceled: tasks.filter(t => t.status === 'canceled').length
      },
      activeSubscriptions: this.subscriptions.size
    };
  }
}

/**
 * Create A2A Bridge instance
 */
export function createA2ABridge(options) {
  return new A2ABridge(options);
}

export default A2ABridge;
