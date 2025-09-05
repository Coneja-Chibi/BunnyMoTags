/**
 * @file Clean BunnyMo Character Display
 * Simple, floating character display system - no more inline cards
 */

import { getContext, extension_settings } from '../../../extensions.js';
import { messageFormatting } from '../../../../script.js';
import { parseBunnyMoData } from './cardRenderer.js';

const MODULE_NAME = 'BunnyMo-Clean';
const IDENTIFIER = 'bunnymo';

/**
 * Main render function - ONLY floating display, no inline cards
 */
export function renderBunnyMoCards(mesId) {
    try {
        console.log(`[${MODULE_NAME}] Processing message ${mesId}`);
        
        // Always hide the original bunnymo code blocks
        hideOriginalBunnyMoBlock(mesId);
        
        // Create or update floating display
        updateFloatingDisplay(mesId);
        
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error processing message:`, error);
    }
}

/**
 * Hide original BunnyMo code blocks in messages
 */
function hideOriginalBunnyMoBlock(mesId) {
    const context = getContext();
    const message = context.chat[mesId];
    if (!message) return;

    const messageElement = document.querySelector(`div[mesid="${mesId}"] .mes_text`);
    if (!messageElement) return;

    // Hide the original bunnymo block
    let displayMessage = message.mes;
    const hideRegex = new RegExp(`\`\`\`${IDENTIFIER}[\\s\\S]*?\`\`\``, 'gm');
    displayMessage = displayMessage.replace(
        hideRegex,
        (match) => `<span style="display: none !important;" class="bunnymo-hidden-data">${match}</span>`
    );

    // Format the message content properly
    messageElement.innerHTML = messageFormatting(
        displayMessage,
        message.name,
        message.is_system,
        message.is_user,
        mesId
    );
}

/**
 * Create or update the floating character display
 */
function updateFloatingDisplay(mesId) {
    const context = getContext();
    const message = context.chat[mesId];
    if (!message) return;

    // Look for BunnyMo data in the message
    const bunnyMoRegex = /```bunnymo[\s\S]*?```/;
    const match = message.mes.match(bunnyMoRegex);
    
    if (!match) return;

    try {
        // Parse the character data
        const content = match[0]
            .replace(/```/g, '')
            .replace(/^bunnymo\s*/, '')
            .trim();
            
        const characterData = parseBunnyMoData(content);
        if (!characterData || !characterData.characters || characterData.characters.length === 0) return;

        // Create or update floating display
        createFloatingDisplay(characterData);
        
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to parse character data:`, error);
    }
}

/**
 * Create the floating character display
 */
function createFloatingDisplay(characterData) {
    // Remove any existing display
    const existing = document.getElementById('bunnymo-floating-display');
    if (existing) existing.remove();

    // Create floating container
    const container = document.createElement('div');
    container.id = 'bunnymo-floating-display';
    container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        width: 350px;
        max-height: calc(100vh - 40px);
        z-index: 30000;
        font-family: var(--mainFontFamily);
        
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        
        overflow: hidden;
        transition: all 0.3s ease;
    `;

    // Create header
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 16px 20px;
        background: rgba(0, 0, 0, 0.1);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
    `;
    
    header.innerHTML = `
        <div style="color: #fff; font-size: 18px; font-weight: 600; text-shadow: 0 1px 3px rgba(0,0,0,0.3);">
            🐰 BunnyMo Characters (${characterData.characters.length})
        </div>
        <div style="color: rgba(255,255,255,0.7); font-size: 14px;">▼</div>
    `;

    // Create content
    const content = document.createElement('div');
    content.style.cssText = `
        padding: 0;
        max-height: calc(100vh - 120px);
        overflow-y: auto;
    `;

    // Add character cards
    characterData.characters.forEach(character => {
        const card = createCharacterCard(character);
        content.appendChild(card);
    });

    // Add collapse/expand functionality
    let isCollapsed = false;
    header.addEventListener('click', () => {
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
            content.style.display = 'none';
            header.querySelector('div:last-child').textContent = '▶';
            container.style.width = '200px';
        } else {
            content.style.display = 'block';
            header.querySelector('div:last-child').textContent = '▼';
            container.style.width = '350px';
        }
    });

    container.appendChild(header);
    container.appendChild(content);
    document.body.appendChild(container);

    console.log(`[${MODULE_NAME}] Created floating display with ${characterData.characters.length} characters`);
}

/**
 * Create individual character card
 */
function createCharacterCard(character) {
    const card = document.createElement('div');
    card.style.cssText = `
        margin: 16px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        overflow: hidden;
        transition: all 0.2s ease;
    `;

    // Character header
    const cardHeader = document.createElement('div');
    cardHeader.style.cssText = `
        padding: 16px 20px 12px;
        background: rgba(0, 0, 0, 0.05);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    `;

    const totalTags = Object.values(character.tags || {}).reduce((sum, tagList) => {
        return sum + (Array.isArray(tagList) ? tagList.length : 0);
    }, 0);

    cardHeader.innerHTML = `
        <div style="color: #fff; font-size: 16px; font-weight: 600; margin-bottom: 4px; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">
            ${character.name}
        </div>
        <div style="color: rgba(255,255,255,0.7); font-size: 12px;">
            ${totalTags} traits • ${character.source || 'BunnyMo'}
        </div>
    `;

    // Tags content
    const tagsContent = document.createElement('div');
    tagsContent.style.cssText = `
        padding: 16px 20px;
    `;

    // Group tags by category
    const groupedTags = groupTags(character.tags || {});
    
    Object.entries(groupedTags).forEach(([category, tags]) => {
        if (tags.length === 0) return;

        const categoryDiv = document.createElement('div');
        categoryDiv.style.cssText = `margin-bottom: 12px;`;

        categoryDiv.innerHTML = `
            <div style="color: rgba(255,255,255,0.9); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
                ${getCategoryIcon(category)} ${category} (${tags.length})
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${tags.map(tag => `
                    <span style="
                        background: ${getCategoryColor(category)}20;
                        border: 1px solid ${getCategoryColor(category)};
                        color: ${getCategoryColor(category)};
                        padding: 3px 8px;
                        border-radius: 12px;
                        font-size: 10px;
                        font-weight: 500;
                    ">${tag}</span>
                `).join('')}
            </div>
        `;

        tagsContent.appendChild(categoryDiv);
    });

    card.appendChild(cardHeader);
    card.appendChild(tagsContent);

    return card;
}

/**
 * Group tags by category
 */
function groupTags(tags) {
    const grouped = {
        personality: [],
        physical: [],
        sexual: [],
        other: []
    };

    Object.entries(tags).forEach(([category, tagList]) => {
        if (!Array.isArray(tagList)) return;
        
        const categoryLower = category.toLowerCase();
        let targetCategory = 'other';

        if (categoryLower.includes('personality') || categoryLower.includes('mental') || categoryLower.includes('behavior')) {
            targetCategory = 'personality';
        } else if (categoryLower.includes('physical') || categoryLower.includes('appearance') || categoryLower.includes('body')) {
            targetCategory = 'physical';
        } else if (categoryLower.includes('sexual') || categoryLower.includes('kinks') || categoryLower.includes('nsfw')) {
            targetCategory = 'sexual';
        }

        grouped[targetCategory].push(...tagList);
    });

    return grouped;
}

/**
 * Get category icon
 */
function getCategoryIcon(category) {
    const icons = {
        personality: '🧠',
        physical: '👁️',
        sexual: '🔥',
        other: '✨'
    };
    return icons[category] || '✨';
}

/**
 * Get category color
 */
function getCategoryColor(category) {
    const colors = {
        personality: '#9C27B0',
        physical: '#FF5722',
        sexual: '#E91E63',
        other: '#9E9E9E'
    };
    return colors[category] || '#9E9E9E';
}

/**
 * Refresh all displays
 */
export function refreshAllBunnyMoCards() {
    console.log(`[${MODULE_NAME}] Refresh called - removing old display`);
    
    // Simply remove existing display - it will recreate on next message
    const existing = document.getElementById('bunnymo-floating-display');
    if (existing) existing.remove();
}