/**
 * @file Clean Message Processor
 * Processes messages for floating character display only
 */

import { getContext } from '../../../extensions.js';
import { renderBunnyMoCards } from './bunnyRenderer.js';

const MODULE_NAME = 'BunnyMo-MessageProcessor';

/**
 * Process message for character cards - redirects to floating display
 */
export function processMessageForSystemCards(messageId) {
    try {
        console.log(`[${MODULE_NAME}] Processing message ${messageId} for floating display`);
        
        // Simply delegate to the floating renderer
        renderBunnyMoCards(messageId);
        
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error processing message:`, error);
    }
}

// Legacy function name for compatibility
export const processMessageForCards = processMessageForSystemCards;

/**
 * Refresh - just remove existing displays
 */
export async function refreshAllBunnyMoCards() {
    console.log(`[${MODULE_NAME}] Refreshing - removing old displays`);
    
    // Remove any old displays
    const oldDisplays = document.querySelectorAll('#bunnymo-floating-display, #bunnymo-cards-container, .bunnymo-wrapper, [class*="bmt-character-card"]');
    oldDisplays.forEach(display => display.remove());
    
    console.log(`[${MODULE_NAME}] Removed ${oldDisplays.length} old displays`);
}