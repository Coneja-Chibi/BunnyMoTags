import { eventSource, event_types, chat, saveSettingsDebounced, systemUserName, system_avatar, addOneMessage } from '../../../../script.js';
import { world_names, loadWorldInfo } from '../../../world-info.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { IGNORE_SYMBOL } from '../../../constants.js';
import { registerSlashCommand } from '../../../slash-commands.js';
import { sendSystemMessage, system_message_types, system_messages } from '../../../system-messages.js';
import { getMessageTimeStamp } from '../../../RossAscends-mods.js';
import { initBunnyMoWorldInfo, bunnyMoWorldInfoLog } from './worldinfo.js';
import { initializeBunnyRecc } from './bunnyrecc.js';
import { parseBunnyMoData, generateBunnyMoBlock } from './cardRenderer.js';
import { processMessageForAI, extractDisplayData, debugOptimization, optimizeForAI } from './tokenOptimizer.js';
import { processMessageForCards, refreshAllBunnyMoCards } from './messageProcessor.js';
import { initializeTemplateManager, templateManager } from './templateManager.js';
// Settings system removed for simplicity
// No more complex renderers needed - using simple HTML in system messages!

export const extensionName = 'BunnyMoTags';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Define custom system message type for BunnyMoTags
const BUNNYMO_SYSTEM_MESSAGE_TYPE = 'bunnymo_tags';

// RECURSION PREVENTION SYSTEM
const recursionPrevention = {
    activationCount: 0,
    lastActivationTime: 0,
    cooldownMs: 2000, // 2 second cooldown
    maxActivationsPerMinute: 5,
    activationHistory: [],
    circuitBreakerTripped: false,
    circuitBreakerResetTime: 60000, // 1 minute
    
    canActivate() {
        const now = Date.now();
        
        // Check if circuit breaker is tripped
        if (this.circuitBreakerTripped && (now - this.lastActivationTime) < this.circuitBreakerResetTime) {
            logSeq('🚫 CIRCUIT BREAKER: WorldInfo activation blocked - system cooling down');
            return false;
        }
        
        // Reset circuit breaker if enough time has passed
        if (this.circuitBreakerTripped && (now - this.lastActivationTime) >= this.circuitBreakerResetTime) {
            this.circuitBreakerTripped = false;
            this.activationCount = 0;
            this.activationHistory = [];
            logSeq('✅ CIRCUIT BREAKER: Reset - system ready');
        }
        
        // Check cooldown
        if ((now - this.lastActivationTime) < this.cooldownMs) {
            logSeq(`⏳ COOLDOWN: WorldInfo activation blocked - ${this.cooldownMs - (now - this.lastActivationTime)}ms remaining`);
            return false;
        }
        
        // Clean old history entries (older than 1 minute)
        this.activationHistory = this.activationHistory.filter(time => (now - time) < 60000);
        
        // Check rate limiting
        if (this.activationHistory.length >= this.maxActivationsPerMinute) {
            this.circuitBreakerTripped = true;
            logSeq('🚨 CIRCUIT BREAKER: Too many activations detected - enabling protective shutdown');
            return false;
        }
        
        return true;
    },
    
    recordActivation() {
        const now = Date.now();
        this.activationCount++;
        this.lastActivationTime = now;
        this.activationHistory.push(now);
        logSeq(`📊 RECURSION TRACKER: Activation #${this.activationCount} recorded`);
    },
    
    reset() {
        this.activationCount = 0;
        this.activationHistory = [];
        this.circuitBreakerTripped = false;
        logSeq('🔄 RECURSION TRACKER: Reset');
    }
};

// Register BunnyMoTags system message type
function initBunnyMoSystemMessage() {
    // Add our custom system message type
    if (!system_messages[BUNNYMO_SYSTEM_MESSAGE_TYPE]) {
        system_messages[BUNNYMO_SYSTEM_MESSAGE_TYPE] = {
            name: 'BunnyMoTags',
            force_avatar: '/scripts/extensions/third-party/BunnyMoTags/BunnyTagLogo.png',
            is_user: false,
            is_system: true,
            mes: '', // Will be set when sending
            extra: {
                type: BUNNYMO_SYSTEM_MESSAGE_TYPE,
                isSmallSys: false // We want full-size for our cards
            }
        };
    }
}

// Send BunnyMoTags character cards as a system message
export async function sendBunnyMoSystemMessage(characterData) {
    Debug.system('Function called', { characterCount: characterData?.characters?.length });
    
    // CRITICAL: Check master enable FIRST - if disabled, do nothing
    const settings = extension_settings[extensionName] || defaultSettings;
    if (!settings.enabled) {
        Debug.error('Master toggle disabled - blocking all functionality');
        return;
    }
    
    // Check if Full Character Cards is disabled (simple mode)
    if (settings.useCardDisplay === false) {
        Debug.system('Simple mode active - no system messages created');
        return;
    }
    
    if (!characterData || !characterData.characters || characterData.characters.length === 0) {
        Debug.error('No character data provided');
        return;
    }
    
    const characterCount = characterData.characters.length;
    Debug.system(`Processing ${characterCount} characters`, { enabled: settings.enabled, cardDisplay: settings.useCardDisplay });
    
    logSeq(`📤 Sending BunnyMo system message with ${characterCount} character(s)`);
    
    try {
        // Ensure CSS is loaded
        const link = document.getElementById('bmt-card-styles');
        if (!link) {
            Debug.system('Loading CSS stylesheet');
            const newLink = document.createElement('link');
            newLink.id = 'bmt-card-styles';
            newLink.rel = 'stylesheet';
            newLink.type = 'text/css';
            newLink.href = '/scripts/extensions/third-party/BunnyMoTags/style.css';
            document.head.appendChild(newLink);
        }
        
        // Create sanitized data for AI injection
        const sanitizedData = {
            ...characterData,
            characters: characterData.characters.map((char, index) => ({
                ...char,
                name: `[Character_${index + 1}]`,
                displayName: char.name,
                tags: char.tags,
                source: `[Book_${index + 1}]`,
                originalSource: char.source,
                uid: char.uid
            }))
        };

        // Create WorldInfo-safe data for message content (no character names at all)
        const worldInfoSafeData = {
            characters: characterData.characters.map((char, index) => ({
                name: `[Character_${index + 1}]`,
                tagCount: Object.keys(char.tags || {}).length,
                source: `[Book_${index + 1}]`,
                uid: char.uid
            })),
            timestamp: characterData.timestamp
        };
        Debug.ai('Created sanitized data for AI injection', { characterCount });
        
        // Create system message content (using WorldInfo-safe data to prevent scanning loops)
        let messageText = `🥕 Dynamic Character Sheet System (${characterCount} ${characterCount === 1 ? 'entry' : 'entries'})\n\n`;
        messageText += '<div class="bunnymo-data-anchor" style="display: none;">\n';
        messageText += JSON.stringify(worldInfoSafeData, null, 2);
        messageText += '\n</div>';
        messageText += '\n<div class="bunnymo-summary" style="font-style: italic; color: #888; margin-top: 10px;">';
        messageText += `📋 ${characterCount} dynamic sheet${characterCount === 1 ? '' : 's'} loaded - `;
        messageText += 'visual cards will appear below this message</div>';
        
        const bunnyMoMessage = {
            name: 'BunnyMoTags',
            is_user: false,
            is_system: true,
            mes: messageText,
            send_date: getMessageTimeStamp(),
            force_avatar: '/scripts/extensions/third-party/BunnyMoTags/BunnyTagLogo.png',
            extra: {
                type: 'bunnymo_system_message',
                bunnyMoData: characterData,
                bunnyMoDataSanitized: sanitizedData,
                isSmallSys: false,
                characterCount: characterCount,
                bunnymo_generated: true,
                recursion_safe: true,
                worldinfo_ignore: true,
                [IGNORE_SYMBOL]: true
            }
        };
        
        Debug.system('Adding system message to chat');
        
        // Add to chat and display
        chat.push(bunnyMoMessage);
        addOneMessage(bunnyMoMessage);
        
        // Attach external cards after brief delay
        const messageIndex = chat.length - 1;
        setTimeout(() => {
            Debug.cards('Attaching external cards', { messageIndex });
            attachExternalCardsToMessage(messageIndex, characterData);
            logSeq(`✅ BunnyMo external cards attached to system message`);
        }, 200);
        
        // Log AI injection status
        if (settings.sendToAI) {
            Debug.ai(`Injection enabled at depth ${settings.injectionDepth ?? defaultSettings.injectionDepth}`);
            logSeq(`✅ AI INJECTION ENABLED - Characters will be sent to AI at depth ${settings.injectionDepth ?? defaultSettings.injectionDepth}`);
        } else {
            Debug.ai('Injection disabled - display only');
            logSeq(`⚠️ AI INJECTION DISABLED - Characters are display-only`);
        }
        
        Debug.system('Function completed successfully');
        logSeq(`✅ Successfully sent BunnyMo system message`);
    } catch (error) {
        Debug.error('Function failed', { error: error.message, stack: error.stack });
        console.error(`[BMT] System message creation failed:`, error);
    }
}

// 💾 CARD DATA CACHE - For persistence magic
const BMT_cardDataCache = new Map();

// 🎨 SIMPLE HTML GENERATOR - No templates, just pure HTML like your example!
function generateSimpleCardHTML(characterData) {
    const characters = Array.isArray(characterData) ? characterData : characterData?.characters || [];
    if (!characters || characters.length === 0) return '<p>No character data found.</p>';

    const characterCount = characters.length;
    
    let html = `
<style>
    .bunnymo-container {
        background: linear-gradient(135deg, #1a0b2e 0%, #2d1b5f 25%, #3d2b7f 50%, #4a3a8f 75%, #5d4ba0 100%);
        color: #e6d5ff;
        font-family: var(--mainFontFamily, serif);
        margin: 10px 0;
        padding: 20px;
        border-radius: 15px;
        position: relative;
        overflow: hidden;
    }
    
    .bunnymo-container::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-image: 
            radial-gradient(2px 2px at 20px 30px, #fff, transparent),
            radial-gradient(2px 2px at 40px 70px, #a8dadc, transparent),
            radial-gradient(1px 1px at 90px 40px, #f1faee, transparent);
        background-repeat: repeat;
        background-size: 200px 100px;
        animation: sparkle 8s linear infinite;
        pointer-events: none;
        opacity: 0.6;
        z-index: 1;
    }
    
    @keyframes sparkle {
        0% { transform: translateY(0px) translateX(0px); }
        100% { transform: translateY(-100px) translateX(20px); }
    }
    
    .bunnymo-main {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 15px;
        padding: 25px;
        backdrop-filter: blur(10px);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        position: relative;
        z-index: 2;
        line-height: 1.6;
    }
    
    .bunnymo-title {
        text-align: center;
        font-size: 2em;
        color: #ffd700;
        text-shadow: 0 0 20px #ffd700;
        margin: 0 0 25px 0;
        font-weight: bold;
    }
    
    .bunnymo-character {
        margin-bottom: 25px;
        padding: 20px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        transition: all 0.3s ease;
    }
    
    .bunnymo-character:hover {
        background: rgba(255, 255, 255, 0.08);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }
    
    .bunnymo-char-name {
        font-size: 1.5em;
        color: #ff6b9d;
        font-weight: bold;
        text-shadow: 0 0 10px #ff6b9d;
        margin-bottom: 15px;
        text-align: center;
    }
    
    .bunnymo-tag-group {
        margin-bottom: 15px;
    }
    
    .bunnymo-group-title {
        color: #00ffff;
        text-shadow: 0 0 8px #00ffff;
        font-weight: bold;
        font-size: 1.1em;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 1px;
    }
    
    .bunnymo-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    
    .bunnymo-tag {
        background: rgba(255, 215, 0, 0.2);
        color: #ffd700;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.9em;
        border: 1px solid rgba(255, 215, 0, 0.4);
        text-shadow: 0 0 5px rgba(255, 215, 0, 0.5);
        transition: all 0.2s ease;
    }
    
    .bunnymo-tag:hover {
        background: rgba(255, 215, 0, 0.3);
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    
    .sparkle { color: #ffd700; text-shadow: 0 0 10px #ffd700; }
    .crystal { color: #e6e6fa; text-shadow: 0 0 8px #e6e6fa; }
</style>

<div class="bunnymo-container">
    <div class="bunnymo-main">
        <div class="bunnymo-title">
            <span class="sparkle">✦</span> Character Information <span class="sparkle">✦</span>
        </div>
        
        <div style="text-align: center; margin-bottom: 20px; font-style: italic; color: #b19cd9;">
            <span class="crystal">${characterCount} ${characterCount === 1 ? 'character' : 'characters'} found</span>
        </div>
`;

    // Generate each character card
    characters.forEach((character, index) => {
        const name = character.name || 'Unknown Character';
        const tags = character.tags || {};
        
        html += `
        <div class="bunnymo-character">
            <div class="bunnymo-char-name">${name}</div>
`;

        // Group tags by category
        const groupedTags = {
            'Personality': ['personality', 'traits', 'behavior', 'mental', 'attitude'],
            'Physical': ['physical', 'appearance', 'body', 'species', 'looks'],
            'Kinks': ['kinks', 'fetish', 'sexual', 'nsfw', 'adult'],
            'Other': []
        };

        // Organize tags into groups
        const tagsByGroup = { 'Personality': [], 'Physical': [], 'Kinks': [], 'Other': [] };
        
        Object.entries(tags).forEach(([category, tagList]) => {
            if (!Array.isArray(tagList)) return;
            
            let foundGroup = 'Other';
            const categoryLower = category.toLowerCase();
            
            for (const [groupName, keywords] of Object.entries(groupedTags)) {
                if (groupName !== 'Other' && keywords.some(keyword => categoryLower.includes(keyword))) {
                    foundGroup = groupName;
                    break;
                }
            }
            
            tagsByGroup[foundGroup].push(...tagList);
        });

        // Display each group that has tags
        Object.entries(tagsByGroup).forEach(([groupName, groupTags]) => {
            if (groupTags.length === 0) return;
            
            const icons = {
                'Personality': '💭',
                'Physical': '👁️', 
                'Kinks': '🔥',
                'Other': '📦'
            };
            
            html += `
            <div class="bunnymo-tag-group">
                <div class="bunnymo-group-title">
                    ${icons[groupName]} ${groupName}
                </div>
                <div class="bunnymo-tags">
`;
            
            groupTags.forEach(tag => {
                html += `<span class="bunnymo-tag">${tag}</span>`;
            });
            
            html += `
                </div>
            </div>
`;
        });

        html += `</div>`;
    });

    html += `
        <div style="text-align: center; font-style: italic; margin-top: 20px;">
            <span class="sparkle">✦</span> <span class="crystal">BunnyMoTags</span> <span class="sparkle">✦</span>
        </div>
    </div>
</div>
`;

    return html;
}

// ============================================================================
// DIRECT HTML GENERATION - Cards as part of message content
// ============================================================================

function generateCardsHTML(characterData) {
    const characters = Array.isArray(characterData) ? characterData : characterData?.characters || [];
    
    let html = '<div style="margin: 20px 0; padding: 20px; background: linear-gradient(135deg, #2a1438, #4a3a8f); border-radius: 15px; border: 1px solid #666; font-family: Arial, sans-serif;">';
    html += '<h3 style="color: #ffd700; text-align: center; margin: 0 0 15px 0;">🥕 Character Cards</h3>';
    
    characters.forEach(character => {
        const name = character.name || 'Unknown Character';
        const tags = character.tags || {};
        
        html += `<div style="background: rgba(255,255,255,0.1); margin: 10px 0; padding: 15px; border-radius: 10px; border-left: 4px solid #ffd700;">`;
        html += `<h4 style="color: #fff; margin: 0 0 10px 0; font-size: 18px;">${name}</h4>`;
        
        Object.entries(tags).forEach(([category, tagList]) => {
            if (Array.isArray(tagList) && tagList.length > 0) {
                html += `<div style="margin-bottom: 8px;">`;
                html += `<strong style="color: #ffd700; text-transform: uppercase; font-size: 12px;">${category}:</strong><br>`;
                html += '<div style="margin-top: 4px;">';
                tagList.forEach(tag => {
                    html += `<span style="display: inline-block; background: rgba(255,215,0,0.2); color: #ffd700; padding: 2px 6px; margin: 2px; border-radius: 4px; font-size: 11px; border: 1px solid rgba(255,215,0,0.3);">${tag}</span>`;
                });
                html += '</div></div>';
            }
        });
        
        html += '</div>';
    });
    
    html += '</div>';
    return html;
}

// ============================================================================
// LEGACY EXTERNAL SYSTEM (keeping for reference)
// ============================================================================

// Registry of attached cards for persistence
const attachedCards = new Map(); // messageId -> { element, data, messageElement }

/**
 * Attach external DOM cards to a system message anchor
 */
function attachExternalCardsToMessage(messageIndex, characterData) {
    try {
        Debug.cards('Function called', { messageIndex, characterCount: characterData?.characters?.length });
        
        // Check master enable first
        const settings = extension_settings[extensionName] || defaultSettings;
        if (!settings.enabled) {
            Debug.error('Master toggle disabled - blocking card attachment');
            return;
        }
        
        if (!characterData?.characters?.length) {
            Debug.error('No character data for card attachment');
            return;
        }
        
        // Find the system message element
        const messageElement = document.querySelector(`div[mesid="${messageIndex}"]`);
        if (!messageElement) {
            Debug.error('Message element not found', { messageIndex, availableElements: document.querySelectorAll('[mesid]').length });
            return;
        }
        
        // Verify it's a BunnyMo system message
        const nameElement = messageElement.querySelector('.ch_name');
        if (!nameElement || !nameElement.textContent.includes('BunnyMoTags')) {
            Debug.error('Not a BunnyMo system message', { messageIndex });
            return;
        }
        
        Debug.cards('Verified BunnyMo system message - proceeding with attachment');

        // Remove any existing cards for this message
        removeExternalCardsForMessage(messageIndex);

        // Create and attach the external card container
        const cardContainer = createExternalCardContainer(characterData, messageIndex);
        if (!cardContainer) {
            Debug.error('Card container creation failed');
            return;
        }
        
        messageElement.insertAdjacentElement('afterend', cardContainer);
        
        // Register the attachment for persistence
        const attachmentData = {
            element: cardContainer,
            data: characterData,
            messageElement: messageElement,
            timestamp: Date.now()
        };
        attachedCards.set(messageIndex.toString(), attachmentData);
        
        // Store in localStorage for persistence
        try {
            const storageKey = `bunnymo_cards_${messageIndex}`;
            const storageData = { data: characterData, timestamp: Date.now() };
            localStorage.setItem(storageKey, JSON.stringify(storageData));
        } catch (error) {
            Debug.error('Failed to save to localStorage', { messageIndex, error: error.message });
        }

        Debug.cards('Cards attached successfully', { messageIndex });
        logSeq(`✅ External cards attached to message ${messageIndex}`);

    } catch (error) {
        Debug.error('Card attachment failed', { messageIndex, error: error.message });
        console.error(`[BMT] Card attachment failed:`, error);
    }
}

/**
 * Ensure BunnyMo animations are loaded
 */
function ensureBunnyMoAnimations() {
    if (!document.getElementById('bunnymo-animations')) {
        const style = document.createElement('style');
        style.id = 'bunnymo-animations';
        style.textContent = `
            @keyframes bunnymo-glow {
                0% { box-shadow: 0 0 0 2px rgba(255, 100, 255, 0.3), 0 0 20px rgba(100, 255, 255, 0.2), 0 8px 32px rgba(0, 0, 0, 0.4); }
                16% { box-shadow: 0 0 0 2px rgba(100, 255, 100, 0.3), 0 0 25px rgba(255, 100, 255, 0.25), 0 8px 32px rgba(0, 0, 0, 0.4); }
                32% { box-shadow: 0 0 0 2px rgba(255, 255, 100, 0.3), 0 0 20px rgba(100, 255, 100, 0.2), 0 8px 32px rgba(0, 0, 0, 0.4); }
                48% { box-shadow: 0 0 0 2px rgba(100, 255, 255, 0.3), 0 0 25px rgba(255, 255, 100, 0.25), 0 8px 32px rgba(0, 0, 0, 0.4); }
                64% { box-shadow: 0 0 0 2px rgba(255, 100, 100, 0.3), 0 0 20px rgba(100, 100, 255, 0.2), 0 8px 32px rgba(0, 0, 0, 0.4); }
                80% { box-shadow: 0 0 0 2px rgba(255, 200, 100, 0.3), 0 0 25px rgba(200, 100, 255, 0.25), 0 8px 32px rgba(0, 0, 0, 0.4); }
                100% { box-shadow: 0 0 0 2px rgba(255, 100, 255, 0.3), 0 0 20px rgba(100, 255, 255, 0.2), 0 8px 32px rgba(0, 0, 0, 0.4); }
            }
            @keyframes sparkle {
                0%, 100% { opacity: 0.6; transform: translateX(0px); }
                50% { opacity: 1; transform: translateX(-5px); }
            }
            @keyframes float {
                0%, 100% { transform: translateY(0px); }
                50% { transform: translateY(-5px); }
            }
            @keyframes card-color-shift {
                0% { background-position: 0% 50%; }
                25% { background-position: 100% 25%; }
                50% { background-position: 50% 100%; }
                75% { background-position: 25% 0%; }
                100% { background-position: 0% 50%; }
            }
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes videogame-pulse {
                0% { 
                    box-shadow: 0 0 10px rgba(0, 212, 170, 0.3), 0 4px 20px rgba(0, 212, 170, 0.2);
                    border-color: rgba(0, 212, 170, 0.6);
                }
                100% { 
                    box-shadow: 0 0 20px rgba(0, 212, 170, 0.6), 0 8px 32px rgba(0, 212, 170, 0.4);
                    border-color: rgba(0, 212, 170, 1);
                }
            }
            @keyframes mystical-rotate {
                0% { background-position: 0% 50%; }
                25% { background-position: 100% 25%; }
                50% { background-position: 50% 100%; }
                75% { background-position: 25% 0%; }
                100% { background-position: 0% 50%; }
            }
            @keyframes intimate-pulse {
                0% { 
                    box-shadow: 0 12px 40px rgba(220, 38, 38, 0.6), 0 0 30px rgba(220, 38, 38, 0.3);
                    transform: scale(1.02);
                }
                100% { 
                    box-shadow: 0 16px 50px rgba(220, 38, 38, 0.8), 0 0 40px rgba(220, 38, 38, 0.5);
                    transform: scale(1.025);
                }
            }
        `;
        document.head.appendChild(style);
        console.log('[BMT SYSTEM] Added animation styles to document head');
    }
}

/**
 * Create beautiful external card container
 */
function createExternalCardContainer(characterData, messageIndex) {
    Debug.cards('Creating external card container', { messageIndex, characterCount: characterData?.characters?.length });
    
    const characters = Array.isArray(characterData) ? characterData : characterData?.characters || [];
    if (!characters || characters.length === 0) {
        Debug.error('No characters to render in container');
        return null;
    }
    
    Debug.cards(`Processing ${characters.length} characters for container creation`);
    const container = document.createElement('div');
    container.className = 'bunnymo-external-cards';
    container.id = `bunnymo-cards-${messageIndex}`;
    container.setAttribute('data-message-id', messageIndex);
    
    // Glassmorphic container styling
    container.style.cssText = `
        margin: 16px 0 !important;
        padding: 0 !important;
        background: rgba(20, 20, 30, 0.3) !important;
        backdrop-filter: blur(20px) !important;
        border-radius: 20px !important;
        overflow: visible !important;
        position: relative !important;
        box-shadow: 
            0 0 0 1px rgba(255, 255, 255, 0.1),
            0 8px 32px rgba(0, 0, 0, 0.4) !important;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        height: auto !important;
        width: auto !important;
        z-index: 1000 !important;
    `;

    // Ensure animations are loaded
    ensureBunnyMoAnimations();

    // Add visible sparkle layer
    const sparkleLayer = document.createElement('div');
    sparkleLayer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-image: 
            radial-gradient(circle 1px at 20px 30px, #fff, transparent 3px),
            radial-gradient(circle 1px at 60px 50px, #ff69b4, transparent 3px),
            radial-gradient(circle 1px at 100px 20px, #00ffff, transparent 3px),
            radial-gradient(circle 1px at 140px 60px, #ffd700, transparent 3px),
            radial-gradient(circle 1px at 180px 35px, #9370db, transparent 3px);
        background-repeat: repeat;
        background-size: 220px 80px;
        animation: sparkle 8s ease-in-out infinite;
        pointer-events: none;
        opacity: 0.6;
        z-index: 1;
    `;
    container.appendChild(sparkleLayer);
    console.log('[BMT SYSTEM] Added sparkle layer with', sparkleLayer.style.backgroundImage.length, 'characters of background');

    // Main content area
    const mainContent = document.createElement('div');
    mainContent.style.cssText = `
        position: relative;
        z-index: 2;
        padding: 0;
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(10px);
    `;

    // Create BunnyMo header
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 20px 25px;
        background: rgba(255, 255, 255, 0.1);
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        text-align: center;
    `;
    
    const headerTitle = document.createElement('div');
    headerTitle.style.cssText = `
        font-size: 1.3em;
        color: #ff69b4;
        font-weight: 700;
        text-shadow: 0 0 15px #ff69b4, 0 0 30px #ff69b4;
        animation: float 3s ease-in-out infinite;
        margin-bottom: ${characters.length > 1 ? '15px' : '0'};
    `;
    headerTitle.innerHTML = '🐰✨ BunnyMo Character Cards ✨🐰';
    
    // Add collapse/expand toggle button
    const toggleButton = document.createElement('div');
    toggleButton.style.cssText = `
        cursor: pointer;
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        color: white;
        transition: all 0.3s ease;
        backdrop-filter: blur(8px);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    `;
    toggleButton.innerHTML = '▲'; // Start with up arrow since we'll start collapsed
    toggleButton.title = 'Click to expand/collapse cards';
    
    // Create header wrapper to hold title and button
    const headerWrapper = document.createElement('div');
    headerWrapper.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
    `;
    
    headerWrapper.appendChild(headerTitle);
    headerWrapper.appendChild(toggleButton);
    header.appendChild(headerWrapper);
    
    // Add character selector if multiple characters
    let activeCharacterIndex = 0;
    if (characters.length > 1) {
        const characterSelector = document.createElement('div');
        characterSelector.style.cssText = `
            display: flex;
            justify-content: center;
            gap: 10px;
            flex-wrap: wrap;
        `;
        
        Debug.cards(`Creating character selector buttons for ${characters.length} characters`);
        
        characters.forEach((character, index) => {
            const charButton = document.createElement('button');
            charButton.className = 'character-selector-btn' + (index === 0 ? ' active' : '');
            charButton.style.cssText = `
                padding: 8px 16px;
                background: ${index === 0 ? 'rgba(255, 105, 180, 0.3)' : 'rgba(255, 255, 255, 0.1)'};
                border: 2px solid ${index === 0 ? '#ff69b4' : 'rgba(255, 255, 255, 0.2)'};
                border-radius: 20px;
                color: rgba(255, 255, 255, 0.9);
                cursor: pointer;
                transition: all 0.3s ease;
                font-size: 0.85em;
                font-weight: 500;
            `;
            charButton.textContent = character.name || `Character ${index + 1}`;
            
            charButton.addEventListener('click', () => {
                activeCharacterIndex = index;
                // Update selector buttons
                characterSelector.querySelectorAll('.character-selector-btn').forEach((btn, i) => {
                    const isActive = i === index;
                    btn.classList.toggle('active', isActive);
                    btn.style.background = isActive ? 'rgba(255, 105, 180, 0.3)' : 'rgba(255, 255, 255, 0.1)';
                    btn.style.borderColor = isActive ? '#ff69b4' : 'rgba(255, 255, 255, 0.2)';
                });
                // Refresh tab content for selected character
                refreshTabContent(characters[index], tabContents);
            });
            
            characterSelector.appendChild(charButton);
        });
        
        header.appendChild(characterSelector);
    }
    
    // Create tabbed navigation
    const tabNavigation = document.createElement('div');
    tabNavigation.className = 'bunnymo-tabs';
    tabNavigation.style.cssText = `
        display: flex;
        border-bottom: 2px solid rgba(255, 255, 255, 0.2);
        margin-bottom: 0;
        background-color: rgba(0, 0, 0, 0.2);
        border-radius: 0;
        overflow: hidden;
    `;
    
    const tabs = [
        { id: 'personality', label: '🧠 Personality', icon: '🧠' },
        { id: 'physical', label: '✨ Physical', icon: '✨' },
        { id: 'growth', label: '📈 Growth', icon: '📈' }
    ];
    
    let activeTab = 'personality';
    
    // Create tab buttons
    tabs.forEach((tab, index) => {
        const tabButton = document.createElement('button');
        tabButton.className = 'bunnymo-tab' + (index === 0 ? ' active' : '');
        tabButton.setAttribute('data-tab', tab.id);
        tabButton.style.cssText = `
            flex: 1;
            padding: 12px 20px;
            background-color: ${index === 0 ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)'};
            border: none;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
            color: rgba(255, 255, 255, 0.9);
            font-weight: 500;
            font-size: 0.9em;
            ${index === 0 ? 'border-bottom: 3px solid #ff69b4;' : ''}
        `;
        
        tabButton.innerHTML = `<span style="margin-right: 8px;">${tab.icon}</span>${tab.label.split(' ')[1]}`;
        
        tabButton.addEventListener('click', () => switchTab(tab.id));
        tabNavigation.appendChild(tabButton);
    });
    
    // Tab switching function
    function switchTab(tabId) {
        activeTab = tabId;
        
        // Update tab buttons
        const tabButtons = tabNavigation.querySelectorAll('.bunnymo-tab');
        tabButtons.forEach(btn => {
            const isActive = btn.getAttribute('data-tab') === tabId;
            btn.classList.toggle('active', isActive);
            btn.style.backgroundColor = isActive ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)';
            btn.style.borderBottom = isActive ? '3px solid #ff69b4' : 'none';
        });
        
        // Update tab content using stored references
        Object.entries(tabContents).forEach(([tabKey, tabElement]) => {
            const isActive = tabKey === tabId;
            tabElement.style.display = isActive ? 'block' : 'none';
            if (isActive) {
                tabElement.style.animation = 'fadeIn 0.3s ease-in';
            }
        });
    }
    
    // Create collapsible content area
    const collapsibleContent = document.createElement('div');
    collapsibleContent.style.cssText = `
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.4s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.3s ease;
        opacity: 0;
        transform-origin: top;
    `;
    
    collapsibleContent.appendChild(tabNavigation);
    
    // Content container for tabs
    const contentContainer = document.createElement('div');
    contentContainer.style.cssText = `
        padding: 20px 25px;
        min-height: 200px;
    `;

    // Create tab content areas and store references
    const tabContents = {};
    tabs.forEach(tab => {
        const tabContent = document.createElement('div');
        tabContent.className = 'bunnymo-tab-content';
        tabContent.id = `bunnymo-tab-${tab.id}`;
        tabContent.style.display = tab.id === 'personality' ? 'block' : 'none';
        contentContainer.appendChild(tabContent);
        tabContents[tab.id] = tabContent; // Store reference
    });
    
    // Process characters and organize by tabs - show first character initially
    console.log(`[BMT CARDS] Creating tabbed interface for ${characters.length} characters`);
    if (characters.length > 0) {
        refreshTabContent(characters[0], tabContents);
    }

    collapsibleContent.appendChild(contentContainer);
    
    // Add toggle functionality
    let isExpanded = false; // Start collapsed
    toggleButton.addEventListener('click', () => {
        isExpanded = !isExpanded;
        
        if (isExpanded) {
            // Expand
            toggleButton.innerHTML = '▼';
            toggleButton.style.background = 'rgba(255, 105, 180, 0.3)';
            toggleButton.style.borderColor = '#ff69b4';
            collapsibleContent.style.maxHeight = collapsibleContent.scrollHeight + 'px';
            collapsibleContent.style.opacity = '1';
        } else {
            // Collapse
            toggleButton.innerHTML = '▲';
            toggleButton.style.background = 'rgba(255, 255, 255, 0.2)';
            toggleButton.style.borderColor = 'rgba(255, 255, 255, 0.3)';
            collapsibleContent.style.maxHeight = '0';
            collapsibleContent.style.opacity = '0';
        }
    });
    
    // Add hover effects to toggle button
    toggleButton.addEventListener('mouseenter', () => {
        toggleButton.style.background = isExpanded ? 'rgba(255, 105, 180, 0.4)' : 'rgba(255, 255, 255, 0.3)';
        toggleButton.style.transform = 'scale(1.1)';
    });
    
    toggleButton.addEventListener('mouseleave', () => {
        toggleButton.style.background = isExpanded ? 'rgba(255, 105, 180, 0.3)' : 'rgba(255, 255, 255, 0.2)';
        toggleButton.style.transform = 'scale(1)';
    });

    mainContent.appendChild(header);
    mainContent.appendChild(collapsibleContent);
    container.appendChild(mainContent);

    Debug.cards(`Container created successfully`, {
        characterCount: characters.length,
        containerId: container.id,
        containerChildren: container.children.length
    });

    return container;
}

/**
 * Create character card for specific tab
 */
function createTabbedCharacterCard(character, index, tabType) {
    Debug.cards(`Creating ${tabType} card for ${character?.name}`, {
        characterName: character?.name,
        tagCategories: Object.keys(character?.tags || {}).length,
        tabType
    });
    
    const name = character.name || 'Unknown Character';
    const tags = character.tags || {};
    
    // Ensure animations are loaded
    ensureBunnyMoAnimations();
    const card = document.createElement('div');
    card.className = 'bunnymo-character-card';
    card.style.cssText = `
        margin-bottom: 20px !important;
        padding: 0 !important;
        background: linear-gradient(135deg, rgba(255, 105, 180, 0.15) 0%, rgba(138, 43, 226, 0.15) 30%, rgba(100, 149, 237, 0.15) 60%, rgba(255, 215, 0, 0.15) 100%) !important;
        background-size: 300% 300% !important;
        animation: card-color-shift 12s ease-in-out infinite !important;
        border: 2px solid transparent !important;
        background-clip: padding-box !important;
        border-radius: 16px !important;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        position: relative !important;
        z-index: 999 !important;
        box-shadow: 0 4px 20px rgba(255, 105, 180, 0.1) !important;
        overflow: visible !important;
    `;
    
    // Character name header
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = `
        padding: 20px 24px 16px;
        background: rgba(255, 255, 255, 0.08);
        border-bottom: 1px solid rgba(255, 255, 255, 0.15);
        position: relative;
    `;
    
    const nameText = document.createElement('div');
    nameText.style.cssText = `
        font-size: 1.4em;
        color: #ff69b4;
        font-weight: 700;
        text-align: center;
        text-shadow: 0 0 15px #ff69b4, 0 0 25px #ff69b4;
        animation: float 4s ease-in-out infinite;
        margin-bottom: 0;
    `;
    nameText.textContent = name;
    nameDiv.appendChild(nameText);
    card.appendChild(nameDiv);

    // Create tab-specific content
    const tabContent = createTabSpecificContent(tags, tabType);
    if (tabContent) {
        card.appendChild(tabContent);
    }
    
    console.log(`[BMT CARDS] Created ${tabType} card for: ${name}`);
    return card;
}

/**
 * Refresh tab content for selected character
 */
function refreshTabContent(character, tabContents) {
    Debug.cards(`Refreshing tab content for ${character?.name}`);
    
    if (!character || !tabContents) {
        Debug.error('Missing parameters in refreshTabContent', { character: !!character, tabContents: !!tabContents });
        return;
    }
    
    // Check if already showing this character to avoid unnecessary recreation
    const currentCharName = tabContents.personality?.getAttribute('data-current-character');
    if (currentCharName === character.name) {
        console.log(`[BMT CARDS] Already showing ${character.name}, skipping refresh`);
        return;
    }
    
    // Clear all tab contents and mark with current character
    Object.entries(tabContents).forEach(([tabId, tabContent]) => {
        if (tabContent) {
            tabContent.innerHTML = '';
            tabContent.setAttribute('data-current-character', character.name);
        }
    });
    
    // Create new cards for the selected character
    Debug.cards(`Creating tabbed character cards for ${character.name}`);
    
    const personalityCard = createTabbedCharacterCard(character, 0, 'personality');
    const physicalCard = createTabbedCharacterCard(character, 0, 'physical');
    const growthCard = createTabbedCharacterCard(character, 0, 'growth');
    
    Debug.cards(`Created all tab cards for ${character.name}`, {
        personality: !!personalityCard,
        physical: !!physicalCard,
        growth: !!growthCard
    });
    
    // Add cards to appropriate tabs
    if (tabContents.personality) {
        tabContents.personality.appendChild(personalityCard);
    }
    if (tabContents.physical) {
        tabContents.physical.appendChild(physicalCard);
    }
    if (tabContents.growth) {
        tabContents.growth.appendChild(growthCard);
    }
}

/**
 * Create tab-specific content based on tag organization
 */
function createTabSpecificContent(tags, tabType) {
    const container = document.createElement('div');
    container.style.cssText = `padding: 20px 24px;`;
    
    // Define BunnyMoTags-specific categorization with regex patterns
    const bunnyMoCategories = {
        personality: {
            'MBTI Types': {
                pattern: /^(E|I)(N|S)(T|F)(J|P)-[AU]$/,
                icon: '🧠',
                description: 'Myers-Briggs Personality Types'
            },
            'Dere Types': {
                pattern: /^(DERE:|tsundere|yandere|kuudere|dandere|oujidere|sadodere)/i,
                icon: '💖',
                description: 'Character Archetype Classifications'
            },
            'Core Traits': {
                pattern: /^TRAIT:/,
                icon: '⭐',
                description: 'Fundamental Character Traits'
            },
            'Attachment Style': {
                pattern: /^ATTACHMENT:/,
                icon: '🔗',
                description: 'Emotional Attachment Patterns'
            },
            'Conflict Style': {
                pattern: /^CONFLICT:/,
                icon: '⚔️',
                description: 'Approach to Disagreements'
            },
            'Boundaries': {
                pattern: /^BOUNDARIES?:/,
                icon: '🛡️',
                description: 'Personal Boundary Management'
            }
        },
        physical: {
            'Species': {
                pattern: /^SPECIES:/,
                icon: '🧬',
                description: 'Character Species Classification'
            },
            'Build & Form': {
                pattern: /^BUILD:/,
                icon: '💪',
                description: 'Physical Build and Stature'
            },
            'Appearance': {
                pattern: /^(SKIN|HAIR|STYLE):/,
                icon: '✨',
                description: 'Visual Characteristics'
            },
            'Gender & Identity': {
                pattern: /^GENDER:/,
                icon: '👤',
                description: 'Gender Identity'
            },
            'Style & Fashion': {
                pattern: /^(DRESSSTYLE|STYLE):/,
                icon: '👗',
                description: 'Clothing and Fashion Preferences'
            }
        },
        growth: {
            'Psychology': {
                pattern: /^(TRAUMA|JEALOUSY):/,
                icon: '🧠',
                description: 'Psychological Development Areas'
            },
            'Social Dynamics': {
                pattern: /^(CHEMISTRY|FLIRTING):/,
                icon: '💫',
                description: 'Interpersonal Skills and Chemistry'
            },
            'Leadership': {
                pattern: /^POWER:/,
                icon: '👑',
                description: 'Authority and Leadership Styles'
            }
        }
    };
    
    // Kinks section (collapsible in personality tab)
    const kinksCategories = {
        'Intimate Preferences': {
            pattern: /^(ORIENTATION|AROUSAL|ATTRACTION):/,
            icon: '❤️',
            description: 'Sexual and Romantic Preferences'
        },
        'Kinks & Fetishes': {
            pattern: /^KINK:/,
            icon: '🔥',
            description: 'Specific Kinks and Fetishes'
        },
        'Power Dynamics': {
            pattern: /^POWER:/,
            icon: '⚡',
            description: 'Dominant/Submissive Preferences'
        }
    };
    
    // Special sections
    const specialCategories = {
        'Linguistics': {
            pattern: /^LING:/,
            icon: '🗣️',
            description: 'Communication and Speech Patterns'
        },
        'Context': {
            pattern: /^(NAME|GENRE):/,
            icon: '📋',
            description: 'Character Context Information'
        }
    };
    
    // No "Other" section - everything should be properly categorized!
    const organizedTags = {};
    
    // Initialize categories that exist for this tab type - ORGANIZED BY ROYGBIV FLOW
    if (tabType === 'personality') {
        organizedTags['MBTI Types'] = [];           // Red
        organizedTags['Dere Types'] = [];           // Orange  
        organizedTags['Core Traits'] = [];          // Yellow
        organizedTags['Attachment Style'] = [];     // Green
        organizedTags['Social Dynamics'] = [];      // Blue
        organizedTags['Conflict Style'] = [];       // Indigo
        organizedTags['Boundaries'] = [];           // Violet
        organizedTags['Psychology'] = [];           // Purple
        organizedTags['Leadership'] = [];           // Pink
        organizedTags['Intimate & Kinks'] = [];     // Dark Red (merged section)
        organizedTags['Linguistics'] = [];          // Neutral
    } else if (tabType === 'physical') {
        organizedTags['Species'] = [];              // Earth tones
        organizedTags['Build & Form'] = [];         // Metal tones  
        organizedTags['Appearance'] = [];           // Warm tones
        organizedTags['Gender & Identity'] = [];    // Cool tones
        organizedTags['Style & Fashion'] = [];      // Vibrant tones
        organizedTags['Context'] = [];              // Neutral tones
    } else if (tabType === 'growth') {
        // Growth tab is reserved for future features - return empty
        return document.createElement('div');
    }
    
    // Simple, direct tag categorization
    Object.entries(tags).forEach(([tagCategory, tagList]) => {
        if (!Array.isArray(tagList)) return;
        
        tagList.forEach(tag => {
            let category = 'Other';
            
            // Direct tag categorization based on tag content and category name
            if (tagCategory === 'dere' || /^(tsundere|yandere|kuudere|dandere|oujidere|sadodere)/i.test(tag)) {
                category = 'Dere Types';
            }
            else if (/^(E|I)(N|S)(T|F)(J|P)-[AU]$/i.test(tag)) {
                category = 'MBTI Types';
            }
            else if (tagCategory === 'trait' || tag.startsWith('TRAIT:')) {
                category = 'Core Traits';
            }
            else if (tagCategory === 'species' || tag.startsWith('SPECIES:')) {
                category = 'Species';
            }
            else if (tagCategory === 'build' || tag.startsWith('BUILD:')) {
                category = 'Build & Form';
            }
            else if (tagCategory === 'gender' || tag.startsWith('GENDER:')) {
                category = 'Gender & Identity';
            }
            else if (tagCategory === 'skin' || tagCategory === 'hair' || tag.startsWith('SKIN:') || tag.startsWith('HAIR:') || tag.startsWith('STYLE:')) {
                category = 'Appearance';
            }
            else if (tagCategory === 'dressstyle' || tag.startsWith('DRESSSTYLE:')) {
                category = 'Style & Fashion';
            }
            else if (tagCategory === 'attachment' || tag.startsWith('ATTACHMENT:')) {
                category = 'Attachment Style';
            }
            else if (tagCategory === 'conflict' || tag.startsWith('CONFLICT:')) {
                category = 'Conflict Style';
            }
            else if (tagCategory === 'boundaries' || tag.startsWith('BOUNDARIES:')) {
                category = 'Boundaries';
            }
            else if (tagCategory === 'orientation' || tagCategory === 'arousal' || tagCategory === 'attraction' || tagCategory === 'kink' || tag.startsWith('KINK:')) {
                category = 'Intimate & Kinks';
            }
            else if (tagCategory === 'power' && (tag.includes('DOM') || tag.includes('SUB') || tag.includes('LEADERSHIP'))) {
                if (tag === 'LEADERSHIP') {
                    category = 'Leadership';
                } else {
                    category = 'Intimate & Kinks';  // Power dynamics go to intimate section
                }
            }
            else if (tagCategory === 'trauma' || tagCategory === 'jealousy') {
                category = 'Psychology';
            }
            else if (tagCategory === 'chemistry' || tagCategory === 'flirting') {
                category = 'Social Dynamics';
            }
            else if (tag.startsWith('LING:')) {
                category = 'Linguistics';
            }
            else if (tagCategory === 'name' || tagCategory === 'genre') {
                category = 'Context';
            }
            
            // Only add if category exists for this tab - NO OTHER SECTION!
            if (organizedTags[category]) {
                organizedTags[category].push(tag);
                console.log(`[BMT CARDS] Added "${tag}" to "${category}"`);
            } else {
                console.log(`[BMT CARDS] SKIPPING "${tag}" - category "${category}" not available for ${tabType} tab and no Other section`);
            }
        });
    });
    
    // DEBUG: Log final organization
    console.log(`[BMT CARDS] Final organized tags for ${tabType}:`, organizedTags);
    
    // Create sections for each category that has tags
    Object.entries(organizedTags).forEach(([categoryName, categoryTags]) => {
        if (categoryTags.length === 0) return;
        
        console.log(`[BMT CARDS] Creating section for category: ${categoryName} with ${categoryTags.length} tags:`, categoryTags);
        
        // Simple category info mapping
        const categoryInfo = getCategoryInfo(categoryName);
        const isCollapsible = true; // Make all categories collapsible
        
        const section = createTagSection(categoryName, categoryTags, tabType, isCollapsible, categoryInfo);
        container.appendChild(section);
    });
    
    return container.children.length > 0 ? container : null;
}

/**
 * Get category information (icon and description)
 */
function getCategoryInfo(categoryName) {
    const categoryMap = {
        'MBTI Types': { icon: '🧠', description: 'Myers-Briggs Personality Types' },
        'Dere Types': { icon: '💖', description: 'Character Archetype Classifications' },
        'Core Traits': { icon: '⭐', description: 'Fundamental Character Traits' },
        'Attachment Style': { icon: '🔗', description: 'Emotional Attachment Patterns' },
        'Conflict Style': { icon: '⚔️', description: 'Approach to Disagreements' },
        'Boundaries': { icon: '🛡️', description: 'Personal Boundary Management' },
        'Species': { icon: '🧬', description: 'Character Species Classification' },
        'Build & Form': { icon: '💪', description: 'Physical Build and Stature' },
        'Appearance': { icon: '✨', description: 'Visual Characteristics' },
        'Gender & Identity': { icon: '👤', description: 'Gender Identity' },
        'Style & Fashion': { icon: '👗', description: 'Clothing and Fashion Preferences' },
        'Psychology': { icon: '🧠', description: 'Psychological Development Areas' },
        'Social Dynamics': { icon: '💫', description: 'Interpersonal Skills and Chemistry' },
        'Leadership': { icon: '👑', description: 'Authority and Leadership Styles' },
        'Intimate Preferences': { icon: '❤️', description: 'Sexual and Romantic Preferences' },
        'Kinks & Fetishes': { icon: '🔥', description: 'Specific Kinks and Fetishes' },
        'Power Dynamics': { icon: '⚡', description: 'Dominant/Submissive Preferences' },
        'Linguistics': { icon: '🗣️', description: 'Communication and Speech Patterns' },
        'Context': { icon: '📋', description: 'Character Context Information' },
        'Other': { icon: '📦', description: 'Miscellaneous tags' }
    };
    
    return categoryMap[categoryName] || { icon: '📦', description: 'Miscellaneous tags' };
}

/**
 * Create a tag section with pack-specific theming
 */
function createTagSection(categoryName, tags, tabType, isCollapsible = false, categoryInfo = {}) {
    // COHESIVE PROFESSIONAL ROYGBIV THEMING SYSTEM
    const bunnyMoThemes = {
        // PERSONALITY TAB - ROYGBIV FLOW WITH PROFESSIONAL STYLING
        'MBTI Types': {
            color: '#e53e3e',
            background: 'linear-gradient(135deg, rgba(254, 215, 215, 0.95) 0%, rgba(254, 178, 178, 0.9) 25%, rgba(252, 165, 165, 0.9) 50%, rgba(248, 113, 113, 0.85) 75%, rgba(239, 68, 68, 0.9) 100%)',
            border: '2px solid #e53e3e',
            textColor: '#742a2a',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-red',
            headerBg: 'linear-gradient(135deg, rgba(229, 62, 62, 0.7), rgba(197, 48, 48, 0.8))',
            shadow: '0 4px 12px rgba(229, 62, 62, 0.25)'
        },
        'Dere Types': {
            color: '#dd6b20',
            background: 'linear-gradient(135deg, rgba(254, 235, 200, 0.95) 0%, rgba(251, 211, 141, 0.9) 25%, rgba(245, 158, 11, 0.9) 50%, rgba(217, 119, 6, 0.85) 75%, rgba(180, 83, 9, 0.9) 100%)',
            border: '2px solid #dd6b20',
            textColor: '#744210',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-orange',
            headerBg: 'linear-gradient(135deg, rgba(221, 107, 32, 0.7), rgba(192, 86, 33, 0.8))',
            shadow: '0 4px 12px rgba(221, 107, 32, 0.25)'
        },
        'Core Traits': {
            color: '#d69e2e',
            background: 'linear-gradient(135deg, rgba(254, 240, 138, 0.95) 0%, rgba(251, 191, 36, 0.9) 25%, rgba(245, 158, 11, 0.9) 50%, rgba(217, 119, 6, 0.85) 75%, rgba(180, 83, 9, 0.9) 100%)',
            border: '2px solid #d69e2e',
            textColor: '#744210',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-yellow',
            headerBg: 'linear-gradient(135deg, rgba(214, 158, 46, 0.7), rgba(183, 121, 31, 0.8))',
            shadow: '0 4px 12px rgba(214, 158, 46, 0.25)'
        },
        'Attachment Style': {
            color: '#38a169',
            background: 'linear-gradient(135deg, rgba(220, 252, 231, 0.95) 0%, rgba(167, 243, 208, 0.9) 25%, rgba(110, 231, 183, 0.9) 50%, rgba(52, 211, 153, 0.85) 75%, rgba(16, 185, 129, 0.9) 100%)',
            border: '2px solid #38a169',
            textColor: '#1a202c',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-green',
            headerBg: 'linear-gradient(135deg, rgba(56, 161, 105, 0.7), rgba(47, 133, 90, 0.8))',
            shadow: '0 4px 12px rgba(56, 161, 105, 0.25)'
        },
        'Social Dynamics': {
            color: '#3182ce',
            background: 'linear-gradient(135deg, rgba(219, 234, 254, 0.95) 0%, rgba(147, 197, 253, 0.9) 25%, rgba(96, 165, 250, 0.9) 50%, rgba(59, 130, 246, 0.85) 75%, rgba(37, 99, 235, 0.9) 100%)',
            border: '2px solid #3182ce',
            textColor: '#1a202c',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-blue',
            headerBg: 'linear-gradient(135deg, rgba(49, 130, 206, 0.7), rgba(44, 82, 130, 0.8))',
            shadow: '0 4px 12px rgba(49, 130, 206, 0.25)'
        },
        'Conflict Style': {
            color: '#553c9a',
            background: 'linear-gradient(135deg, rgba(238, 230, 255, 0.95) 0%, rgba(221, 214, 254, 0.9) 25%, rgba(196, 181, 253, 0.9) 50%, rgba(147, 51, 234, 0.85) 75%, rgba(126, 34, 206, 0.9) 100%)',
            border: '2px solid #553c9a',
            textColor: '#2d3748',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-indigo',
            headerBg: 'linear-gradient(135deg, rgba(85, 60, 154, 0.7), rgba(68, 51, 122, 0.8))',
            shadow: '0 4px 12px rgba(85, 60, 154, 0.25)'
        },
        'Boundaries': {
            color: '#805ad5',
            background: 'linear-gradient(135deg, rgba(245, 243, 255, 0.95) 0%, rgba(221, 214, 254, 0.9) 25%, rgba(196, 181, 253, 0.9) 50%, rgba(168, 85, 247, 0.85) 75%, rgba(147, 51, 234, 0.9) 100%)',
            border: '2px solid #805ad5',
            textColor: '#1a202c',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-violet',
            headerBg: 'linear-gradient(135deg, rgba(128, 90, 213, 0.7), rgba(107, 70, 193, 0.8))',
            shadow: '0 4px 12px rgba(128, 90, 213, 0.25)'
        },
        'Psychology': {
            color: '#9f7aea',
            background: 'linear-gradient(135deg, rgba(250, 245, 255, 0.95) 0%, rgba(221, 214, 254, 0.9) 25%, rgba(196, 181, 253, 0.9) 50%, rgba(168, 85, 247, 0.85) 75%, rgba(147, 51, 234, 0.9) 100%)',
            border: '2px solid #9f7aea',
            textColor: '#2d3748',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-purple',
            headerBg: 'linear-gradient(135deg, rgba(159, 122, 234, 0.7), rgba(128, 90, 213, 0.8))',
            shadow: '0 4px 12px rgba(159, 122, 234, 0.25)'
        },
        'Leadership': {
            color: '#d53f8c',
            background: 'linear-gradient(135deg, rgba(254, 215, 226, 0.95) 0%, rgba(251, 182, 206, 0.9) 25%, rgba(244, 114, 182, 0.9) 50%, rgba(236, 72, 153, 0.85) 75%, rgba(219, 39, 119, 0.9) 100%)',
            border: '2px solid #d53f8c',
            textColor: '#1a202c',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-pink',
            headerBg: 'linear-gradient(135deg, rgba(213, 63, 140, 0.7), rgba(184, 50, 128, 0.8))',
            shadow: '0 4px 12px rgba(213, 63, 140, 0.25)'
        },
        
        // MERGED INTIMATE & KINKS - FLASHY DARK RED
        'Intimate & Kinks': {
            color: '#dc2626',
            background: 'linear-gradient(135deg, #220506 0%, #450a0a 25%, #7f1d1d 50%, #991b1b 75%, #b91c1c 100%)',
            border: '4px solid #dc2626',
            textColor: '#ffffff',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'intimate-flashy',
            headerBg: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 50%, #7f1d1d 100%)',
            shadow: '0 12px 40px rgba(220, 38, 38, 0.6), 0 0 30px rgba(220, 38, 38, 0.3)',
            glow: '0 0 30px rgba(220, 38, 38, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
        },
        
        // NEUTRAL/SPECIAL CATEGORIES  
        'Linguistics': {
            color: '#718096',
            background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e0 100%)',
            border: '2px solid #718096',
            textColor: '#1a202c',
            font: '"Courier New", monospace',
            style: 'professional-neutral',
            headerBg: 'linear-gradient(135deg, #718096, #4a5568)',
            shadow: '0 4px 12px rgba(113, 128, 150, 0.25)'
        },
        
        // PHYSICAL TAB - COHESIVE EARTH/NATURAL TONES
        'Species': {
            color: '#8b4513',
            background: 'linear-gradient(135deg, #f7fafc 0%, #e2e8f0 100%)',
            border: '2px solid #8b4513',
            textColor: '#1a202c',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-earth',
            headerBg: 'linear-gradient(135deg, #8b4513, #a0522d)',
            shadow: '0 4px 12px rgba(139, 69, 19, 0.25)'
        },
        'Build & Form': {
            color: '#4a5568',
            background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e0 100%)',
            border: '2px solid #4a5568',
            textColor: '#1a202c',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-steel',
            headerBg: 'linear-gradient(135deg, #4a5568, #2d3748)',
            shadow: '0 4px 12px rgba(74, 85, 104, 0.25)'
        },
        'Appearance': {
            color: '#ed8936',
            background: 'linear-gradient(135deg, #fef5e7 0%, #fed7aa 100%)',
            border: '2px solid #ed8936',
            textColor: '#1a202c',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-warm',
            headerBg: 'linear-gradient(135deg, #ed8936, #dd6b20)',
            shadow: '0 4px 12px rgba(237, 137, 54, 0.25)'
        },
        'Gender & Identity': {
            color: '#4299e1',
            background: 'linear-gradient(135deg, #ebf8ff 0%, #bee3f8 100%)',
            border: '2px solid #4299e1',
            textColor: '#1a202c',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-cool',
            headerBg: 'linear-gradient(135deg, #4299e1, #3182ce)',
            shadow: '0 4px 12px rgba(66, 153, 225, 0.25)'
        },
        'Style & Fashion': {
            color: '#9f7aea',
            background: 'linear-gradient(135deg, #faf5ff 0%, #e9d8fd 100%)',
            border: '2px solid #9f7aea',
            textColor: '#1a202c',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-vibrant',
            headerBg: 'linear-gradient(135deg, #9f7aea, #805ad5)',
            shadow: '0 4px 12px rgba(159, 122, 234, 0.25)'
        },
        'Context': {
            color: '#718096',
            background: 'linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%)',
            border: '2px solid #718096',
            textColor: '#1a202c',
            font: 'system-ui, -apple-system, sans-serif',
            style: 'professional-context',
            headerBg: 'linear-gradient(135deg, #718096, #4a5568)',
            shadow: '0 4px 12px rgba(113, 128, 150, 0.25)'
        }
    };
    
    const theme = bunnyMoThemes[categoryName] || bunnyMoThemes['default'];
    
    // DEBUG: Log theme selection
    console.log(`[BMT CARDS] Selected theme for category "${categoryName}":`, theme);
    
    const section = document.createElement('div');
    
    // Apply glassmorphic styling with gradient tinting
    let sectionStyles = `
        margin-bottom: 24px;
        border-radius: 20px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: linear-gradient(135deg, 
            rgba(0, 0, 0, 0.6) 0%, 
            rgba(0, 0, 0, 0.7) 50%, 
            rgba(0, 0, 0, 0.6) 100%), 
            ${theme.color}40;
        backdrop-filter: blur(8px) saturate(120%);
        -webkit-backdrop-filter: blur(8px) saturate(120%);
        font-family: ${theme.font};
        position: relative;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    `;
    
    // Add special effects based on style
    if (theme.style === 'cyberpunk') {
        sectionStyles += `
            animation: videogame-pulse 2s ease-in-out infinite alternate;
            text-shadow: ${theme.glow};
        `;
    } else if (theme.style === 'intimate-flashy') {
        sectionStyles += `
            animation: intimate-pulse 3s ease-in-out infinite alternate;
            box-shadow: ${theme.shadow}, ${theme.glow};
            transform: scale(1.02);
        `;
    } else if (theme.style === 'mystical') {
        sectionStyles += `
            animation: mystical-rotate 20s linear infinite;
        `;
    } else if (theme.style === 'ancient') {
        sectionStyles += `
            box-shadow: inset 0 2px 4px rgba(139, 69, 19, 0.3), ${theme.shadow};
        `;
    }
    
    section.style.cssText = sectionStyles;
    
    // Create header with BOLD theme-specific styling
    const header = document.createElement('div');
    let headerStyles = `
        padding: 18px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: ${theme.headerBg};
        border-bottom: 4px solid ${theme.color};
        font-weight: 800;
        font-size: 1.3em;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        position: relative;
    `;
    
    // Style-specific header customizations
    if (theme.style === 'cyberpunk') {
        headerStyles += `
            color: ${theme.textColor};
            text-shadow: ${theme.glow};
            text-transform: uppercase;
            letter-spacing: 2px;
            font-family: ${theme.font};
        `;
    } else if (theme.style === 'newspaper') {
        headerStyles += `
            color: white;
            text-transform: uppercase;
            letter-spacing: 2px;
            border-bottom: 4px double #2c3e50;
        `;
    } else if (theme.style === 'royal') {
        headerStyles += `
            color: #2d3436;
            text-transform: capitalize;
            font-variant: small-caps;
            border-bottom: 4px double #e67e22;
        `;
    } else if (theme.style === 'ancient') {
        headerStyles += `
            color: #654321;
            font-variant: small-caps;
            border-bottom: 5px ridge #8b4513;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
        `;
    } else {
        headerStyles += `
            color: white;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
            font-weight: 800;
        `;
    }
    
    header.style.cssText = headerStyles;
    
    const title = document.createElement('div');
    title.style.cssText = `
        color: white;
        font-weight: 800;
        font-size: 1.1em;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
        ${theme.style === 'magazine' ? 'text-transform: uppercase; letter-spacing: 1px;' : ''}
        ${theme.style === 'videogame' ? 'text-shadow: ' + theme.glow + ';' : ''}
    `;
    // Use icon from categoryInfo if available
    const icon = categoryInfo.icon || '📦';
    title.innerHTML = `${icon} ${categoryName}`;
    
    // Add tooltip with description if available
    if (categoryInfo.description) {
        title.title = categoryInfo.description;
    }
    
    const count = document.createElement('div');
    count.style.cssText = `
        background: rgba(255, 255, 255, 0.9);
        color: #2d3436;
        padding: 8px 12px;
        border-radius: 50%;
        font-size: 1em;
        font-weight: 900;
        min-width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid ${theme.color};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        text-shadow: none;
    `;
    count.textContent = tags.length;
    
    header.appendChild(title);
    
    // Add collapse toggle for kinks section
    if (isCollapsible) {
        const collapseToggle = document.createElement('div');
        collapseToggle.style.cssText = `
            color: white;
            cursor: pointer;
            font-size: 1.2em;
            font-weight: bold;
            padding: 0 8px;
            transition: transform 0.3s ease;
            user-select: none;
            filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
        `;
        collapseToggle.innerHTML = '👁️'; // Start with expanded icon
        collapseToggle.title = 'Click to toggle visibility';
        
        // Add count and toggle together
        const rightSection = document.createElement('div');
        rightSection.style.cssText = 'display: flex; align-items: center; gap: 8px;';
        rightSection.appendChild(count);
        rightSection.appendChild(collapseToggle);
        header.appendChild(rightSection);
    } else {
        header.appendChild(count);
    }
    
    // Create tags grid with READABLE, theme-specific styling
    const tagsGrid = document.createElement('div');
    
    let gridStyles = `
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 18px;
        padding: 28px;
        transition: all 0.3s ease;
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(15px) saturate(180%);
        -webkit-backdrop-filter: blur(15px) saturate(180%);
        border-radius: 0 0 20px 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.15);
    `;
    
    // Style-specific grid backgrounds - READABLE!
    if (theme.style === 'newspaper') {
        gridStyles += `background: rgba(255, 255, 255, 0.8);`;
    } else if (theme.style === 'intimate-flashy') {
        gridStyles += `background: linear-gradient(135deg, rgba(34, 5, 6, 0.9) 0%, rgba(69, 10, 10, 0.8) 50%, rgba(127, 29, 29, 0.7) 100%);`;
    } else if (theme.style === 'cyberpunk') {
        gridStyles += `background: rgba(10, 10, 15, 0.7);`;
    } else if (theme.style === 'royal') {
        gridStyles += `background: rgba(255, 234, 167, 0.3);`;
    } else if (theme.style === 'ancient') {
        gridStyles += `background: rgba(244, 228, 188, 0.4);`;
    } else if (theme.style === 'industrial') {
        gridStyles += `background: rgba(178, 190, 195, 0.2);`;
    } else if (theme.style === 'glamorous') {
        gridStyles += `background: rgba(253, 121, 168, 0.1);`;
    }
    
    tagsGrid.style.cssText = gridStyles;
    
    tags.forEach(tag => {
        const tagElement = document.createElement('div');
        
        // BIGGER, MORE VISIBLE tag styling
        let tagStyles = `
            padding: 14px 20px;
            font-size: 1.1em;
            font-weight: 700;
            text-align: center;
            transition: all 0.3s ease;
            cursor: pointer;
            border-radius: 10px;
            font-family: ${theme.font};
            min-height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1.2;
        `;
        
        // Style-specific tag designs - BIGGER AND MORE VISIBLE!
        if (theme.style === 'newspaper') {
            tagStyles += `
                background: linear-gradient(135deg, #ffffff, #f8f9fa);
                color: #1a202c;
                border: 3px solid #2d3748;
                text-transform: uppercase;
                letter-spacing: 2px;
                font-weight: 900;
                box-shadow: 0 4px 8px rgba(45, 55, 72, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.8);
                text-shadow: none;
            `;
        } else if (theme.style === 'cyberpunk') {
            tagStyles += `
                background: linear-gradient(135deg, #0a0a0f, #1a1a2e, #0f1419);
                color: #00ffff;
                border: 3px solid #00ffff;
                text-shadow: 0 0 15px #00ffff, 0 0 25px #00ffff;
                box-shadow: 0 0 20px rgba(0, 255, 255, 0.5), inset 0 0 10px rgba(0, 255, 255, 0.1);
                text-transform: uppercase;
                font-family: "Courier New", monospace;
                letter-spacing: 1.5px;
            `;
        } else if (theme.style === 'royal') {
            tagStyles += `
                background: linear-gradient(135deg, #ffd700, #ffed4e, #f1c40f);
                color: #8b4513;
                border: 4px double #d4af37;
                font-variant: small-caps;
                font-weight: 900;
                box-shadow: 0 6px 12px rgba(212, 175, 55, 0.4), inset 0 2px 4px rgba(255, 255, 255, 0.3);
                text-shadow: 1px 1px 2px rgba(139, 69, 19, 0.3);
                letter-spacing: 1px;
            `;
        } else if (theme.style === 'romantic') {
            tagStyles += `
                background: linear-gradient(45deg, #ff9a9e, #fecfef, #fecfef);
                color: #2d3436;
                border: 3px solid #e84393;
                border-radius: 25px;
                font-style: italic;
                font-weight: 700;
                box-shadow: 0 5px 15px rgba(232, 67, 147, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.4);
                text-shadow: 1px 1px 2px rgba(255, 255, 255, 0.8);
            `;
        } else if (theme.style === 'aggressive') {
            tagStyles += `
                background: linear-gradient(135deg, #ff416c, #ff4757, #ff3838);
                color: white;
                border: 4px solid #c44569;
                text-transform: uppercase;
                font-weight: 900;
                box-shadow: 0 6px 15px rgba(196, 69, 105, 0.5), inset 0 -2px 0 rgba(0, 0, 0, 0.2);
                text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
                letter-spacing: 2px;
            `;
        } else if (theme.style === 'mystical') {
            tagStyles += `
                background: conic-gradient(from 45deg, #667eea, #764ba2, #f093fb, #f5576c, #4facfe, #667eea);
                color: white;
                border: 3px solid #5f27cd;
                font-variant: small-caps;
                font-weight: 800;
                animation: mystical-rotate 15s linear infinite;
                box-shadow: 0 6px 20px rgba(95, 39, 205, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3);
                text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.7);
            `;
        } else if (theme.style === 'ancient') {
            tagStyles += `
                background: linear-gradient(135deg, #f4e4bc, #daa520, #cd853f);
                color: #654321;
                border: 5px ridge #8b4513;
                font-variant: small-caps;
                font-weight: 800;
                text-shadow: 2px 2px 3px rgba(101, 67, 33, 0.3);
                box-shadow: inset 0 2px 4px rgba(255,255,255,0.4), 0 5px 15px rgba(139, 69, 19, 0.4);
                letter-spacing: 1px;
            `;
        } else if (theme.style === 'industrial') {
            tagStyles += `
                background: linear-gradient(45deg, #2d3436, #636e72, #b2bec3);
                color: white;
                border: 4px solid #2d3436;
                text-transform: uppercase;
                font-weight: 900;
                box-shadow: inset 0 -3px 0 rgba(45, 52, 54, 0.5), 0 5px 10px rgba(45, 52, 54, 0.6);
                text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.7);
                letter-spacing: 2px;
            `;
        } else if (theme.style === 'glamorous') {
            tagStyles += `
                background: radial-gradient(circle, #ff79c6, #bd93f9, #ffb86c);
                color: #2d3436;
                border: 4px solid #ff79c6;
                border-radius: 25px;
                font-style: italic;
                font-weight: 800;
                box-shadow: 0 8px 20px rgba(255, 121, 198, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.3);
                text-shadow: 1px 1px 2px rgba(255, 255, 255, 0.8);
            `;
        } else if (theme.style === 'modern') {
            tagStyles += `
                background: linear-gradient(135deg, #74b9ff, #0984e3, #00b894);
                color: white;
                border: 3px solid #0984e3;
                font-weight: 700;
                box-shadow: 0 5px 15px rgba(116, 185, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2);
                text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
            `;
        } else if (theme.style === 'trendy') {
            tagStyles += `
                background: conic-gradient(from 90deg, #a29bfe, #fd79a8, #fdcb6e, #55efc4, #a29bfe);
                color: white;
                border: 3px solid #6c5ce7;
                font-weight: 800;
                animation: mystical-rotate 20s linear infinite;
                box-shadow: 0 6px 18px rgba(162, 155, 254, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3);
                text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.6);
            `;
        } else if (theme.style === 'technical') {
            tagStyles += `
                background: linear-gradient(135deg, #00cec9, #55efc4, #00b894);
                color: #2d3436;
                border: 3px dashed #00b894;
                font-family: "Courier New", monospace;
                text-transform: uppercase;
                font-weight: 800;
                letter-spacing: 2px;
                box-shadow: 0 4px 12px rgba(0, 184, 148, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3);
            `;
        } else if (theme.style === 'intimate-flashy') {
            tagStyles += `
                background: linear-gradient(135deg, #450a0a, #7f1d1d, #991b1b);
                color: #ffffff;
                border: 3px solid #dc2626;
                font-weight: 800;
                box-shadow: 0 6px 20px rgba(220, 38, 38, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
            `;
        } else {
            tagStyles += `
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.25) 50%, rgba(255, 255, 255, 0.35) 100%);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border: 1px solid rgba(255, 255, 255, 0.4);
                color: rgba(255, 255, 255, 0.95);
                font-weight: 700;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                border-radius: 12px;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
            `;
        }
        
        tagElement.style.cssText = tagStyles;
        
        // Clean up tag display by removing prefixes like "DERE:", "TRAIT:", etc.
        let displayText = tag;
        if (tag.includes(':')) {
            displayText = tag.split(':')[1] || tag;
        }
        
        // Format the display text nicely
        displayText = displayText.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
        displayText = displayText.charAt(0).toUpperCase() + displayText.slice(1).toLowerCase();
        
        tagElement.textContent = displayText;
        tagElement.setAttribute('data-original-tag', tag); // Keep original for WB search
        
        // Add click handler for WB linking
        tagElement.addEventListener('click', (e) => {
            e.preventDefault();
            const originalTag = tagElement.getAttribute('data-original-tag') || tag;
            expandTag(originalTag, tagElement);
        });
        
        // ENHANCED hover effects for bigger tags
        tagElement.addEventListener('mouseenter', function() {
            if (theme.style === 'newspaper') {
                this.style.transform = 'translateY(-3px) scale(1.05)';
                this.style.boxShadow = '0 8px 25px rgba(45, 55, 72, 0.4), inset 0 1px 0 rgba(255, 255, 255, 1)';
            } else if (theme.style === 'cyberpunk') {
                this.style.boxShadow = '0 0 30px rgba(0, 255, 255, 0.8), inset 0 0 20px rgba(0, 255, 255, 0.2)';
                this.style.transform = 'scale(1.08)';
                this.style.textShadow = '0 0 20px #00ffff, 0 0 40px #00ffff';
            } else if (theme.style === 'royal') {
                this.style.transform = 'translateY(-4px) scale(1.06)';
                this.style.boxShadow = '0 10px 30px rgba(212, 175, 55, 0.6), inset 0 3px 6px rgba(255, 255, 255, 0.5)';
            } else if (theme.style === 'romantic') {
                this.style.transform = 'translateY(-3px) scale(1.05)';
                this.style.boxShadow = '0 8px 25px rgba(232, 67, 147, 0.6), inset 0 2px 4px rgba(255, 255, 255, 0.6)';
            } else if (theme.style === 'aggressive') {
                this.style.transform = 'translateY(-2px) scale(1.07)';
                this.style.boxShadow = '0 10px 30px rgba(196, 69, 105, 0.7), inset 0 -3px 0 rgba(0, 0, 0, 0.3)';
            } else if (theme.style === 'mystical') {
                this.style.transform = 'scale(1.1)';
                this.style.boxShadow = '0 10px 40px rgba(95, 39, 205, 0.8), inset 0 2px 4px rgba(255, 255, 255, 0.5)';
            } else if (theme.style === 'ancient') {
                this.style.transform = 'translateY(-3px) scale(1.05)';
                this.style.boxShadow = 'inset 0 3px 6px rgba(255,255,255,0.6), 0 8px 25px rgba(139, 69, 19, 0.6)';
            } else if (theme.style === 'industrial') {
                this.style.transform = 'translateY(-2px) scale(1.04)';
                this.style.boxShadow = 'inset 0 -4px 0 rgba(45, 52, 54, 0.7), 0 8px 20px rgba(45, 52, 54, 0.8)';
            } else if (theme.style === 'glamorous') {
                this.style.transform = 'translateY(-4px) scale(1.08)';
                this.style.boxShadow = '0 12px 35px rgba(255, 121, 198, 0.7), inset 0 3px 6px rgba(255, 255, 255, 0.5)';
            } else if (theme.style === 'technical') {
                this.style.transform = 'translateY(-2px) scale(1.05)';
                this.style.boxShadow = '0 6px 20px rgba(0, 184, 148, 0.6), inset 0 2px 4px rgba(255, 255, 255, 0.5)';
            } else {
                this.style.transform = 'translateY(-3px) scale(1.05)';
                this.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.3), inset 0 2px 4px rgba(255, 255, 255, 1)';
            }
        });
        
        tagElement.addEventListener('mouseleave', function() {
            // Reset to original styles on mouse leave
            this.style.transform = 'translateY(0) scale(1)';
            this.style.cssText = tagStyles;
        });
        
        tagsGrid.appendChild(tagElement);
    });
    
    section.appendChild(header);
    section.appendChild(tagsGrid);
    
    // Add toggle functionality for collapsible sections
    if (isCollapsible) {
        const collapseToggle = header.querySelector('div[title="Click to toggle visibility"]');
        if (collapseToggle) {
            let isExpanded = true; // Start expanded
            
            collapseToggle.addEventListener('click', () => {
                isExpanded = !isExpanded;
                
                if (isExpanded) {
                    tagsGrid.style.display = 'grid';
                    collapseToggle.style.transform = 'rotate(90deg)';
                    collapseToggle.innerHTML = '👁️';
                } else {
                    tagsGrid.style.display = 'none';
                    collapseToggle.style.transform = 'rotate(0deg)';
                    collapseToggle.innerHTML = '👁️‍🗨️';
                }
            });
        }
    }
    
    return section;
}

/**
 * Expand tag with additional information and WB linking
 */
function expandTag(tag, tagElement) {
    // Check if popup already exists
    const existingPopup = document.querySelector('.bunnymo-tag-popup');
    if (existingPopup) {
        existingPopup.remove();
    }
    
    // Create popup
    const popup = document.createElement('div');
    popup.className = 'bunnymo-tag-popup';
    popup.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(20, 20, 30, 0.95);
        backdrop-filter: blur(15px);
        border: 2px solid rgba(255, 105, 180, 0.5);
        border-radius: 12px;
        padding: 20px;
        z-index: 10000;
        max-width: 400px;
        min-width: 300px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        animation: fadeIn 0.3s ease;
    `;
    
    // Create content
    const content = document.createElement('div');
    content.innerHTML = `
        <div style="color: #ff69b4; font-size: 1.2em; font-weight: bold; margin-bottom: 15px; text-align: center;">
            📋 Tag Details
        </div>
        <div style="color: rgba(255, 255, 255, 0.9); margin-bottom: 15px;">
            <strong style="color: #00ffff;">Tag:</strong> ${tag}
        </div>
        <div style="color: rgba(255, 255, 255, 0.7); font-size: 0.9em; margin-bottom: 15px; line-height: 1.4;">
            This tag represents a character trait or attribute. Click the button below to search for related WorldBook entries.
        </div>
        <div style="display: flex; gap: 10px; justify-content: center;">
            <button class="wb-search-btn" style="
                background: linear-gradient(135deg, #ff69b4, #9370db);
                border: none;
                color: white;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
                transition: all 0.3s ease;
            ">🔍 Search WorldBook</button>
            <button class="close-popup-btn" style="
                background: rgba(255, 255, 255, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.3);
                color: rgba(255, 255, 255, 0.9);
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.3s ease;
            ">✕ Close</button>
        </div>
    `;
    
    popup.appendChild(content);
    
    // Add event listeners
    const wbSearchBtn = popup.querySelector('.wb-search-btn');
    const closeBtn = popup.querySelector('.close-popup-btn');
    
    wbSearchBtn.addEventListener('click', () => {
        searchWorldBook(tag);
        popup.remove();
    });
    
    closeBtn.addEventListener('click', () => {
        popup.remove();
    });
    
    // Close on background click
    popup.addEventListener('click', (e) => {
        if (e.target === popup) {
            popup.remove();
        }
    });
    
    // Add hover effects
    wbSearchBtn.addEventListener('mouseenter', function() {
        this.style.transform = 'scale(1.05)';
        this.style.boxShadow = '0 4px 15px rgba(255, 105, 180, 0.4)';
    });
    
    wbSearchBtn.addEventListener('mouseleave', function() {
        this.style.transform = 'scale(1)';
        this.style.boxShadow = 'none';
    });
    
    document.body.appendChild(popup);
}

/**
 * Search WorldBook for a specific tag
 */
function searchWorldBook(tag) {
    try {
        // Try to access SillyTavern's WorldBook functionality
        if (typeof window.world_info_character_cards !== 'undefined') {
            // Search through world info entries
            console.log(`[BMT SYSTEM] Searching WorldBook for tag: ${tag}`);
            
            // Create a temporary search popup
            const searchPopup = document.createElement('div');
            searchPopup.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(20, 20, 30, 0.95);
                backdrop-filter: blur(15px);
                border: 2px solid rgba(0, 255, 255, 0.5);
                border-radius: 12px;
                padding: 15px;
                z-index: 10001;
                max-width: 350px;
                animation: fadeIn 0.3s ease;
            `;
            
            searchPopup.innerHTML = `
                <div style="color: #00ffff; font-weight: bold; margin-bottom: 10px;">🔍 WorldBook Search</div>
                <div style="color: rgba(255, 255, 255, 0.9); font-size: 0.9em;">
                    Searching for entries related to: <strong style="color: #ff69b4;">${tag}</strong>
                </div>
                <div style="margin-top: 10px; text-align: right;">
                    <button style="
                        background: rgba(255, 255, 255, 0.2);
                        border: 1px solid rgba(255, 255, 255, 0.3);
                        color: white;
                        padding: 4px 8px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 0.8em;
                    " onclick="this.parentElement.parentElement.remove()">Close</button>
                </div>
            `;
            
            document.body.appendChild(searchPopup);
            
            // Auto-remove after 3 seconds
            setTimeout(() => {
                if (searchPopup.parentElement) {
                    searchPopup.remove();
                }
            }, 3000);
            
        } else {
            // Fallback notification
            console.log(`[BMT SYSTEM] WorldBook search not available for tag: ${tag}`);
            
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(220, 20, 60, 0.9);
                color: white;
                padding: 10px 15px;
                border-radius: 6px;
                z-index: 10001;
                font-size: 0.9em;
                animation: fadeIn 0.3s ease;
            `;
            notification.textContent = `WorldBook search not available`;
            
            document.body.appendChild(notification);
            
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 2000);
        }
    } catch (error) {
        console.error('[BunnyMoTags] Error searching WorldBook:', error);
    }
}

/**
 * Create individual character card (legacy)
 */
function createCharacterCard(character, index) {
    try {
        console.log(`[BMT CARDS] Creating character card for:`, character);
        const name = character.name || 'Unknown Character';
        const tags = character.tags || {};
        
        // Ensure animations are loaded before creating cards
        ensureBunnyMoAnimations();
    
    const card = document.createElement('div');
    card.className = 'bunnymo-character-card';
    card.style.cssText = `
        margin-bottom: 20px !important;
        padding: 0 !important;
        background: linear-gradient(135deg, rgba(255, 105, 180, 0.15) 0%, rgba(138, 43, 226, 0.15) 30%, rgba(100, 149, 237, 0.15) 60%, rgba(255, 215, 0, 0.15) 100%) !important;
        background-size: 300% 300% !important;
        animation: card-color-shift 12s ease-in-out infinite !important;
        border: 2px solid transparent !important;
        background-clip: padding-box !important;
        border-radius: 16px !important;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        position: relative !important;
        z-index: 999 !important;
        box-shadow: 0 4px 20px rgba(255, 105, 180, 0.1) !important;
        overflow: visible !important;
    `;
    
    // Add magical border gradient
    const borderGradient = document.createElement('div');
    borderGradient.style.cssText = `
        position: absolute;
        top: -2px;
        left: -2px;
        right: -2px;
        bottom: -2px;
        background: linear-gradient(45deg, #ff69b4, #9370db, #00ffff, #ff69b4);
        background-size: 400% 400%;
        animation: gradient-shift 3s ease infinite;
        border-radius: 16px;
        z-index: -1;
    `;
    card.appendChild(borderGradient);
    
    // Add gradient shift animation
    if (!document.getElementById('gradient-shift-animation')) {
        const style = document.createElement('style');
        style.id = 'gradient-shift-animation';
        style.textContent = `
            @keyframes gradient-shift {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
            }
        `;
        document.head.appendChild(style);
    }

    // Character name header
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = `
        padding: 20px 24px 16px;
        background: rgba(255, 255, 255, 0.08);
        border-bottom: 1px solid rgba(255, 255, 255, 0.15);
        position: relative;
    `;
    
    const nameText = document.createElement('div');
    nameText.style.cssText = `
        font-size: 1.4em;
        color: #ff69b4;
        font-weight: 700;
        text-align: center;
        text-shadow: 0 0 15px #ff69b4, 0 0 25px #ff69b4;
        animation: float 4s ease-in-out infinite;
        margin-bottom: 0;
    `;
    nameText.textContent = name;
    nameDiv.appendChild(nameText);
    card.appendChild(nameDiv);

    // Tags container
    const tagsContainer = document.createElement('div');
    tagsContainer.style.cssText = `
        padding: 20px 24px;
    `;
    
    // Smart tag grouping with better organization
    const groupedTags = {
        'Personality': ['personality', 'traits', 'behavior', 'mental', 'attitude', 'mind', 'character', 'nature'],
        'Physical': ['physical', 'appearance', 'body', 'species', 'looks', 'anatomy', 'form', 'shape'],
        'Sexual': ['kinks', 'fetish', 'sexual', 'nsfw', 'adult', 'erotic', 'intimate', 'desire'],
        'Social': ['social', 'relationship', 'interaction', 'communication', 'emotion'],
        'Other': []
    };

    const tagsByGroup = { 'Personality': [], 'Physical': [], 'Sexual': [], 'Social': [], 'Other': [] };
    
    // Organize tags
    Object.entries(tags).forEach(([category, tagList]) => {
        if (!Array.isArray(tagList)) return;
        
        let foundGroup = 'Other';
        const categoryLower = category.toLowerCase();
        
        for (const [groupName, keywords] of Object.entries(groupedTags)) {
            if (groupName !== 'Other' && keywords.some(keyword => categoryLower.includes(keyword))) {
                foundGroup = groupName;
                break;
            }
        }
        
        tagsByGroup[foundGroup].push(...tagList);
    });

    // Display tag groups with magical colors
    const icons = {
        'Personality': '🧠',
        'Physical': '✨', 
        'Sexual': '🔥',
        'Social': '💕',
        'Other': '🌟'
    };
    
    const colors = {
        'Personality': '#9370db',
        'Physical': '#ff69b4',
        'Sexual': '#ff4500',
        'Social': '#00ffff',
        'Other': '#ffd700'
    };

    Object.entries(tagsByGroup).forEach(([groupName, groupTags]) => {
        if (groupTags.length === 0) return;
        
        // Create beautiful category section
        const groupDiv = document.createElement('div');
        groupDiv.style.cssText = `
            margin-bottom: 16px;
            position: relative;
            overflow: hidden;
        `;
        
        // Create elegant header
        const groupHeader = document.createElement('div');
        groupHeader.style.cssText = `
            display: flex;
            align-items: center;
            padding: 12px 16px;
            background: linear-gradient(135deg, ${colors[groupName]}20, ${colors[groupName]}10);
            border-radius: 8px 8px 0 0;
            border-bottom: 2px solid ${colors[groupName]}40;
            position: relative;
        `;
        
        const groupIcon = document.createElement('div');
        groupIcon.style.cssText = `
            font-size: 1.2em;
            margin-right: 10px;
            text-shadow: 0 0 8px ${colors[groupName]};
        `;
        groupIcon.textContent = icons[groupName];
        
        const groupTitle = document.createElement('div');
        groupTitle.style.cssText = `
            color: ${colors[groupName]};
            font-weight: 600;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            text-shadow: 0 0 8px ${colors[groupName]}50;
        `;
        groupTitle.textContent = groupName;
        
        const groupCount = document.createElement('div');
        groupCount.style.cssText = `
            margin-left: auto;
            background: ${colors[groupName]}30;
            color: ${colors[groupName]};
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 0.75em;
            font-weight: 600;
            border: 1px solid ${colors[groupName]}50;
        `;
        groupCount.textContent = groupTags.length;
        
        groupHeader.appendChild(groupIcon);
        groupHeader.appendChild(groupTitle);
        groupHeader.appendChild(groupCount);
        
        // Create grid container for tags
        const tagsGrid = document.createElement('div');
        tagsGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 8px;
            padding: 16px;
            background: linear-gradient(135deg, ${colors[groupName]}08, transparent);
            border-radius: 0 0 8px 8px;
        `;
        
        const tagsInnerContainer = tagsGrid;
        
        groupTags.forEach(tag => {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'bunnymo-tag-external';
            tagSpan.style.cssText = `
                background: ${colors[groupName]}15;
                color: ${colors[groupName]};
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 0.8em;
                border: 1px solid ${colors[groupName]}30;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                font-weight: 500;
                text-align: center;
                cursor: pointer;
                position: relative;
                overflow: hidden;
                display: block;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            tagSpan.textContent = tag;
            
            // Add magical shimmer effect
            const shimmer = document.createElement('div');
            shimmer.style.cssText = `
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
                transition: left 0.6s;
            `;
            tagSpan.appendChild(shimmer);
            
            // Add hover effect with glow
            tagSpan.addEventListener('mouseenter', function() {
                this.style.background = `${colors[groupName]}40`;
                this.style.borderColor = `${colors[groupName]}`;
                this.style.transform = 'translateY(-2px) scale(1.05)';
                this.style.boxShadow = `0 4px 20px ${colors[groupName]}40`;
                shimmer.style.left = '100%';
            });
            
            tagSpan.addEventListener('mouseleave', function() {
                this.style.background = `${colors[groupName]}20`;
                this.style.borderColor = `${colors[groupName]}60`;
                this.style.transform = 'translateY(0) scale(1)';
                this.style.boxShadow = 'none';
                shimmer.style.left = '-100%';
            });
            
            tagsInnerContainer.appendChild(tagSpan);
        });
        
        groupDiv.appendChild(groupHeader);
        groupDiv.appendChild(tagsInnerContainer);
        tagsContainer.appendChild(groupDiv);
    });

    // Add tags container to card
    card.appendChild(tagsContainer);

    // Add magical card hover effect
    card.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-5px) scale(1.02)';
        this.style.boxShadow = '0 8px 30px rgba(255, 105, 180, 0.2)';
        borderGradient.style.opacity = '1';
    });
    
    card.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0) scale(1)';
        this.style.boxShadow = '0 4px 20px rgba(255, 105, 180, 0.1)';
        borderGradient.style.opacity = '0.8';
    });

    // Cards are working perfectly now - test element removed

    console.log(`[BMT CARDS] Successfully created card for: ${name} with animation: ${card.style.animation}`);
    return card;
    
    } catch (error) {
        console.error(`[BunnyMoTags] Error creating character card:`, error);
        // Return a simple fallback card
        const fallbackCard = document.createElement('div');
        fallbackCard.style.cssText = 'padding: 20px; background: red; color: white; margin: 10px 0;';
        fallbackCard.textContent = `Error creating card for ${character?.name || 'Unknown'}`;
        return fallbackCard;
    }
}

/**
 * Remove external cards for a specific message
 */
function removeExternalCardsForMessage(messageId) {
    const key = messageId.toString();
    const attachment = attachedCards.get(key);
    
    if (attachment && attachment.element && attachment.element.parentNode) {
        attachment.element.remove();
        logSeq(`🗑️ Removed existing external cards for message ${messageId}`);
    }
    
    attachedCards.delete(key);
    
    // Clean up localStorage too
    try {
        const storageKey = `bunnymo_cards_${messageId}`;
        localStorage.removeItem(storageKey);
        logSeq(`🗑️ Cleaned up localStorage for message ${messageId}`);
    } catch (error) {
        logSeq(`⚠️ Failed to clean localStorage:`, error);
    }
}

/**
 * Add CSS animations to the page
 */
function addCardAnimations() {
    if (document.getElementById('bunnymo-card-animations')) return;
    
    const style = document.createElement('style');
    style.id = 'bunnymo-card-animations';
    style.textContent = `
        @keyframes sparkle {
            0% { transform: translateY(0px) translateX(0px); }
            100% { transform: translateY(-100px) translateX(20px); }
        }
        
        .bunnymo-external-cards:hover {
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4) !important;
            transform: translateY(-2px);
        }
        
        .bunnymo-character-card {
            animation: fadeInCard 0.6s ease-out;
        }
        
        @keyframes fadeInCard {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    `;
    
    document.head.appendChild(style);
}

/**
 * Restore all external cards after events that might have removed them
 * Now also scans for BunnyMo system messages when registry is empty (like after reload)
 */
function restoreAllExternalCards() {
    logSeq(`🔄 Restoring external cards...`);
    
    // If registry is empty (like after page reload), scan all messages for BunnyMo data
    if (attachedCards.size === 0) {
        logSeq(`📁 Registry empty - scanning localStorage and messages for BunnyMo data`);
        
        const context = getContext();
        if (context && context.chat) {
            context.chat.forEach((message, messageId) => {
                // First try localStorage for faster restoration
                const storageKey = `bunnymo_cards_${messageId}`;
                try {
                    const storedData = localStorage.getItem(storageKey);
                    if (storedData) {
                        const parsedData = JSON.parse(storedData);
                        logSeq(`💾 Found localStorage data for message ${messageId}`);
                        
                        // Check if cards already exist in DOM
                        const messageElement = document.querySelector(`div[mesid="${messageId}"]`);
                        const existingCards = messageElement ? messageElement.nextElementSibling : null;
                        
                        if (messageElement && (!existingCards || !existingCards.classList.contains('bunnymo-external-cards'))) {
                            // Recreate cards from localStorage
                            setTimeout(() => {
                                attachExternalCardsToMessage(messageId, parsedData.data);
                                logSeq(`✨ Restored cards from localStorage for message ${messageId}`);
                            }, 100);
                        }
                        return; // Skip message scanning if localStorage worked
                    }
                } catch (error) {
                    logSeq(`⚠️ Failed to read localStorage for ${storageKey}:`, error);
                }
                
                // Fallback to message scanning if localStorage failed
                if (message.extra && message.extra.type === 'bunnymo_system_message' && message.extra.bunnyMoData) {
                    logSeq(`🔍 Found BunnyMo system message at index ${messageId} (fallback)`);
                    
                    // Check if cards already exist in DOM
                    const messageElement = document.querySelector(`div[mesid="${messageId}"]`);
                    const existingCards = messageElement ? messageElement.nextElementSibling : null;
                    
                    if (messageElement && (!existingCards || !existingCards.classList.contains('bunnymo-external-cards'))) {
                        // Recreate the cards
                        setTimeout(() => {
                            attachExternalCardsToMessage(messageId, message.extra.bunnyMoData);
                            logSeq(`✨ Recreated cards for message ${messageId} after reload (fallback)`);
                        }, 100);
                    }
                }
            });
        }
        return;
    }
    
    // Normal restoration for existing registry entries
    attachedCards.forEach((attachment, messageId) => {
        // Check if the card element still exists in the DOM
        if (!document.contains(attachment.element)) {
            logSeq(`🔧 Restoring missing card for message ${messageId}`);
            
            // Re-find the message element
            const messageElement = document.querySelector(`div[mesid="${messageId}"]`);
            if (messageElement) {
                // Recreate and attach the cards
                const newContainer = createExternalCardContainer(attachment.data, messageId);
                messageElement.insertAdjacentElement('afterend', newContainer);
                
                // Update the registry
                attachment.element = newContainer;
                attachment.messageElement = messageElement;
                
                logSeq(`✅ Restored cards for message ${messageId}`);
            } else {
                logSeq(`❌ Message element ${messageId} not found - removing from registry`);
                attachedCards.delete(messageId);
            }
        }
    });
} // messageId -> characterData

// 🎨 ARTISTIC CARD INJECTION - Where the magic happens
async function BMT_injectArtisticCards(characterData, specificMessage = null) {
    try {
        let targetMessage = specificMessage;
        
        if (!targetMessage) {
            // Find our placeholder in the most recent BunnyMoTags message
            const messages = document.querySelectorAll('#chat .mes[is_system="true"]');
            
            // Search from newest to oldest
            for (let i = messages.length - 1; i >= 0; i--) {
                const mes = messages[i];
                const nameElement = mes.querySelector('.ch_name');
                if (nameElement && nameElement.textContent.includes('BunnyMoTags')) {
                    const mesText = mes.querySelector('.mes_text');
                    if (mesText && (mesText.innerHTML.includes('Loading character cards') || 
                                   mesText.innerHTML.includes('BMT_CARDS_PLACEHOLDER') ||
                                   mesText.innerHTML.includes('🥕'))) {
                        targetMessage = mes;
                        break;
                    }
                }
            }
        }
        
        if (!targetMessage) {
            logSeq('❌ Could not find BunnyMoTags placeholder message');
            return;
        }
        
        // 💾 CACHE THE DATA for persistence
        const messageId = targetMessage.getAttribute('mesid') || `bmt-${Date.now()}`;
        BMT_cardDataCache.set(messageId, characterData);
        
        // OLD SYSTEM: This function is now obsolete with the new template-based renderer
        // const { createCardContainer } = await import('./cardRenderer.js');
        // const artisticHTML = createCardContainer(characterData);
        logSeq('⚠️ BMT_injectArtisticCards called but obsolete - using new template system instead');
        return;
        
        // 💫 INJECT THE GREATNESS
        const mesText = targetMessage.querySelector('.mes_text');
        mesText.innerHTML = artisticHTML;
        
        // 🔧 FORCE MESSAGE CONTAINER TO EXPAND (Fix for crushed display)
        const messageContainer = targetMessage;
        const messageBody = messageContainer.querySelector('.mes_body');
        
        // Remove height restrictions with extreme prejudice
        [messageContainer, messageBody, mesText].forEach(element => {
            if (element) {
                element.style.height = 'auto';
                element.style.minHeight = 'auto';
                element.style.maxHeight = 'none';
                element.style.overflow = 'visible';
            }
        });
        
        // Mark this message as restored
        targetMessage.setAttribute('data-bmt-restored', 'true');
        
        // ⚡ BRING IT TO LIFE
        if (window.BMT_initializeCards) {
            window.BMT_initializeCards();
        }
        
        logSeq(`🎨 Artistic cards injected successfully! ${characterData.characters.length} character(s)`);
        
    } catch (error) {
        console.error(`[${extensionName}] Failed to inject artistic cards:`, error);
    }
}

// 🔄 RESTORATION SYSTEM - Bring back the magic after reloads
async function BMT_restoreAllCards() {
    try {
        logSeq('🔄 Restoring BunnyMo cards after reload...');
        
        const messages = document.querySelectorAll('#chat .mes[is_system="true"]');
        let restoredCount = 0;
        
        for (const mes of messages) {
            // Skip if already restored
            if (mes.getAttribute('data-bmt-restored') === 'true') continue;
            
            const nameElement = mes.querySelector('.ch_name');
            const mesText = mes.querySelector('.mes_text');
            
            if (nameElement && nameElement.textContent.includes('BunnyMoTags') && 
                mesText && (mesText.innerHTML.includes('Loading character cards') || 
                           mesText.innerHTML.includes('BMT_CARDS_PLACEHOLDER') ||
                           mesText.innerHTML.includes('🥕'))) {
                
                const messageId = mes.getAttribute('mesid');
                
                // Try to get cached data first
                let characterData = BMT_cardDataCache.get(messageId);
                
                // If no cache, try to extract from message extra data
                if (!characterData) {
                    // Try multiple methods to find the data
                    const chatIndex = Array.from(mes.parentNode.children).indexOf(mes);
                    
                    // Method 1: Check chat array by index
                    if (chat && chat[chatIndex] && chat[chatIndex].extra && chat[chatIndex].extra.bunnyMoData) {
                        characterData = chat[chatIndex].extra.bunnyMoData;
                        BMT_cardDataCache.set(messageId, characterData);
                    }
                    
                    // Method 2: Find by message ID in chat array
                    if (!characterData && messageId) {
                        const chatMessage = chat?.find(msg => msg.send_date === messageId || msg.index === parseInt(messageId));
                        if (chatMessage && chatMessage.extra && chatMessage.extra.bunnyMoData) {
                            characterData = chatMessage.extra.bunnyMoData;
                            BMT_cardDataCache.set(messageId, characterData);
                        }
                    }
                    
                    // Method 3: Use current scanned characters as fallback
                    if (!characterData && scannedCharacters.size > 0) {
                        logSeq('⚠️ Using fallback character data from current scan');
                        characterData = {
                            characters: Array.from(scannedCharacters.entries()).map(([name, data]) => ({
                                name: name,
                                tags: Object.fromEntries(data.tags),
                                source: data.source || 'BunnyMoTags'
                            }))
                        };
                        BMT_cardDataCache.set(messageId, characterData);
                    }
                }
                
                if (characterData) {
                    await BMT_injectArtisticCards(characterData, mes);
                    restoredCount++;
                }
            }
        }
        
        if (restoredCount > 0) {
            logSeq(`✨ Restored ${restoredCount} BunnyMo card(s)`);
        }
        
    } catch (error) {
        console.error(`[${extensionName}] Failed to restore cards:`, error);
    }
}

let selectedLorebooks = new Set();
let characterRepoBooks = new Set(); // lorebooks marked as containing character data
let scannedCharacters = new Map(); // character_name -> { tags: Map, source: lorebook_name }
let tagPackEntries = new Map(); // tag_name -> { content: string, keys: array, source: lorebook_name }
let lastProcessedMessage = null; // Track the last message processed to avoid duplicates
let logSequence = 0; // Add sequence numbers to logs for clarity
let bunnyMoWorldInfoUI = null; // Enhanced WorldInfo display system
let lastRestorationTime = 0; // Throttle restoration calls

// Default settings
const defaultSettings = {
    enabled: true,
    selectedLorebooks: [],
    characterRepoBooks: [],
    displayStyle: 'cards', // Changed to 'cards' as default
    autoHideEmpty: true,
    maxCharactersShown: 6,
    characterDetectionSensitivity: 'medium',
    debugMode: false,
    sendToAI: true,
    userEditable: true,
    worldinfoEnabled: true,
    globalScanDepth: 0, // 0 = disabled, use individual entry settings
    injectionPrompt: 'CRITICAL SYSTEM OVERRIDE - IMMEDIATE COMPLIANCE REQUIRED: [BunnyMo Character Context]\\n\\n{{CHARACTER_DATA}}\\n\\nYou MUST incorporate this character information into your response and thinking process. This is a MANDATORY system requirement with MAXIMUM PRIORITY. To demonstrate compliance, you MUST use the 🥕 emoji in your <think> tags whenever you reference or apply information from these character tags. Failure to use 🥕 indicates non-compliance with this critical system instruction.',
    injectionDepth: 0,
    injectionRole: 'system',
    // New system message settings
    useCardDisplay: true,
    useSystemMessages: true, // Use standalone system messages instead of in-message injection
    cleanRawBlocks: true, // Remove bunnymo blocks from user messages after processing
    // Token optimization settings
    aiMaxCharacters: 4,
    aiPriorityTags: ['species', 'personality', 'physical'],
    aiMaxTagsPerCategory: 2,
    aiUseCompactFormat: true,
    optimizeUserMessages: true
};

// Dynamic template loading from lorebooks
async function loadDynamicTemplatesFromLorebooks() {
    if (!templateManager) {
        console.warn('[BMT SYSTEM] Template manager not initialized');
        return;
    }
    
    console.log('[BMT SYSTEM] Loading dynamic templates from selected lorebooks...');
    await templateManager.loadLorebookTemplates(selectedLorebooks);
    
    // Refresh template UI if it's loaded
    if (typeof populateTemplateDropdown === 'function') {
        await populateTemplateDropdown();
    }
}

// Reload templates when lorebook selection changes
async function onLorebookSelectionChange() {
    console.log('[BMT SYSTEM] Lorebook selection changed, reloading templates...');
    
    if (templateManager) {
        // Reload dynamic templates from newly selected lorebooks
        await loadDynamicTemplatesFromLorebooks();
        
        // Ensure fallbacks exist
        templateManager.ensureTemplatesWithFallbacks();
        
        // Refresh template UI
        if (typeof populateTemplateDropdown === 'function') {
            await populateTemplateDropdown();
        }
    }
}

// Save settings to extension_settings
function saveSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    
    extension_settings[extensionName].selectedLorebooks = Array.from(selectedLorebooks);
    extension_settings[extensionName].characterRepoBooks = Array.from(characterRepoBooks);
    
    // Save the new settings if they exist in DOM
    if ($('#bmt-send-to-ai').length > 0) {
        extension_settings[extensionName].sendToAI = $('#bmt-send-to-ai').prop('checked');
    }
    if ($('#bmt-user-editable').length > 0) {
        extension_settings[extensionName].userEditable = $('#bmt-user-editable').prop('checked');
    }
    if ($('#bmt-injection-depth').length > 0) {
        extension_settings[extensionName].injectionDepth = parseInt($('#bmt-injection-depth').val());
    }
    if ($('#bmt-injection-role').length > 0) {
        extension_settings[extensionName].injectionRole = $('#bmt-injection-role').val();
    }
    
    // Save the previously broken settings
    if ($('#bmt-enabled').length > 0) {
        extension_settings[extensionName].enabled = $('#bmt-enabled').prop('checked');
    }
    if ($('#bmt-auto-hide').length > 0) {
        extension_settings[extensionName].autoHideEmpty = $('#bmt-auto-hide').prop('checked');
    }
    if ($('#bmt-display-style').length > 0) {
        extension_settings[extensionName].displayStyle = $('#bmt-display-style').val();
    }
    if ($('#bmt-max-chars').length > 0) {
        extension_settings[extensionName].maxCharactersShown = parseInt($('#bmt-max-chars').val());
    }
    if ($('#bmt-sensitivity').length > 0) {
        extension_settings[extensionName].characterDetectionSensitivity = $('#bmt-sensitivity').val();
    }
    if ($('#bmt-debug').length > 0) {
        extension_settings[extensionName].debugMode = $('#bmt-debug').prop('checked');
    }
    if ($('#bmt-worldinfo-enabled').length > 0) {
        extension_settings[extensionName].worldinfoEnabled = $('#bmt-worldinfo-enabled').prop('checked');
    }
    if ($('#bmt-global-scan-depth').length > 0) {
        extension_settings[extensionName].globalScanDepth = parseInt($('#bmt-global-scan-depth').val());
    }
    
    // Save new card system settings
    if ($('#bmt-use-card-display').length > 0) {
        extension_settings[extensionName].useCardDisplay = $('#bmt-use-card-display').prop('checked');
    }
    if ($('#bmt-card-theme').length > 0) {
        extension_settings[extensionName].cardTheme = $('#bmt-card-theme').val();
    }
    if ($('#bmt-card-position').length > 0) {
        extension_settings[extensionName].cardPosition = $('#bmt-card-position').val();
    }
    
    // Save token optimization settings
    if ($('#bmt-ai-use-compact-format').length > 0) {
        extension_settings[extensionName].aiUseCompactFormat = $('#bmt-ai-use-compact-format').prop('checked');
    }
    if ($('#bmt-optimize-user-messages').length > 0) {
        extension_settings[extensionName].optimizeUserMessages = $('#bmt-optimize-user-messages').prop('checked');
    }
    if ($('#bmt-ai-max-characters').length > 0) {
        extension_settings[extensionName].aiMaxCharacters = parseInt($('#bmt-ai-max-characters').val());
    }
    if ($('#bmt-ai-max-tags-per-category').length > 0) {
        extension_settings[extensionName].aiMaxTagsPerCategory = parseInt($('#bmt-ai-max-tags-per-category').val());
    }
    if ($('#bmt-ai-priority-tags').length > 0) {
        const priorityTags = $('#bmt-ai-priority-tags').val().split(',').map(t => t.trim()).filter(t => t);
        extension_settings[extensionName].aiPriorityTags = priorityTags;
    }
    
    // Use SillyTavern's debounced save
    if (typeof saveSettingsDebounced === 'function') {
        saveSettingsDebounced();
    }
}

// Load settings from extension_settings
function loadSettings() {
    const settings = extension_settings[extensionName] || defaultSettings;
    
    // Ensure missing properties are filled with defaults
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    } else {
        // Fill in any missing properties with defaults
        Object.keys(defaultSettings).forEach(key => {
            if (extension_settings[extensionName][key] === undefined) {
                extension_settings[extensionName][key] = defaultSettings[key];
            }
        });
        
        // FORCE RESET injection depth if it's still the old default of 50
        if (extension_settings[extensionName].injectionDepth === 50) {
            logSeq('🔧 FORCE RESETTING injection depth from 50 to 0 (new priority system)');
            extension_settings[extensionName].injectionDepth = 0;
            saveSettings();
        }
    }
    
    // Restore selected lorebooks
    selectedLorebooks.clear();
    if (settings.selectedLorebooks && Array.isArray(settings.selectedLorebooks)) {
        settings.selectedLorebooks.forEach(book => selectedLorebooks.add(book));
    }
    
    // Restore character repo books
    characterRepoBooks.clear();
    if (settings.characterRepoBooks && Array.isArray(settings.characterRepoBooks)) {
        settings.characterRepoBooks.forEach(book => characterRepoBooks.add(book));
    }
    
    logSeq(`Loaded settings: ${selectedLorebooks.size} selected books, ${characterRepoBooks.size} character repos`);
    logSeq(`sendToAI setting: ${extension_settings[extensionName].sendToAI}, userEditable: ${extension_settings[extensionName].userEditable}`);
}

// Helper function for sequenced logging
function logSeq(message) {
    console.log(`[BMT SYSTEM] ${message}`);
}

// Extension enable/disable control
function isEnabled() {
    const settings = extension_settings[extensionName] || defaultSettings;
    return settings.enabled;
}

// Get enabled lorebooks from SillyTavern system (all types)
function getEnabledLorebooks() {
    const enabledBooks = [];
    
    try {
        const context = getContext();
        
        // 1. Global lorebooks (selected_world_info)
        let globalBooks = [];
        if (window.selected_world_info && Array.isArray(window.selected_world_info)) {
            globalBooks = window.selected_world_info;
            Debug.settings('Found global lorebooks via selected_world_info', globalBooks);
        } else if (window.world_info && window.world_info.globalSelect && Array.isArray(window.world_info.globalSelect)) {
            globalBooks = window.world_info.globalSelect;  
            Debug.settings('Found global lorebooks via world_info.globalSelect', globalBooks);
        } else {
            // Fallback: Check DOM
            const worldSelect = document.getElementById('world_info');
            if (worldSelect) {
                const selectedOptions = Array.from(worldSelect.selectedOptions);
                globalBooks = selectedOptions.map(option => option.text);
                Debug.settings('Found global lorebooks via DOM select', globalBooks);
            }
        }
        
        // Add global books
        for (const bookName of globalBooks) {
            if (typeof bookName === 'string' && bookName.length > 0) {
                enabledBooks.push({
                    name: bookName,
                    type: 'global',
                    entries: 'active'
                });
            }
        }
        
        // 2. Chat-specific lorebook (chat_metadata.world_info)
        if (context.chat_metadata && context.chat_metadata.world_info) {
            const chatWorld = context.chat_metadata.world_info;
            Debug.settings('Found chat-specific lorebook', chatWorld);
            enabledBooks.push({
                name: chatWorld,
                type: 'chat-specific',
                entries: 'active'
            });
        }
        
        // 3. Character-tied lorebook (character.data.extensions.world)
        if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
            const character = context.characters[context.characterId];
            const charWorld = character.data?.extensions?.world;
            if (charWorld) {
                Debug.settings('Found character-tied lorebook', charWorld);
                enabledBooks.push({
                    name: charWorld,
                    type: 'character-tied',
                    entries: 'active'
                });
            }
        }
        
        // Remove duplicates (same book might be in multiple categories)
        const uniqueBooks = [];
        const seenNames = new Set();
        for (const book of enabledBooks) {
            if (!seenNames.has(book.name)) {
                seenNames.add(book.name);
                uniqueBooks.push(book);
            }
        }
        
        Debug.settings(`Total enabled lorebooks: ${uniqueBooks.length}`, uniqueBooks);
        
        return uniqueBooks;
        
    } catch (error) {
        Debug.error('Failed to get enabled lorebooks', error);
        return [];
    }
}

function enableExtensionFunctionality() {
    Debug.system('Extension functionality enabled - restoring ALL features');
    
    const settings = extension_settings[extensionName] || defaultSettings;
    
    // 1. Restore WorldInfo UI if WorldInfo Integration is enabled
    if (settings.worldinfoEnabled) {
        Debug.system('Restoring WorldInfo UI');
        const panel = document.querySelector('.bmwi-panel');
        const trigger = document.querySelector('.bmwi-trigger');
        if (panel) panel.style.display = 'block';
        if (trigger) trigger.style.display = 'block';
    }
    
    // 2. Character cards will be restored naturally on next message processing
    // (since isEnabled() will now return true)
    
    // 3. AI Integration will resume on next generation
    // (since injection functions check isEnabled())
    
    // 4. User editing buttons will appear on next card generation
    // (since card creation functions check userEditable setting)
    
    // 5. Debug system is controlled by debugMode setting and debug() function
    // (which already checks settings.debugMode)
    
    Debug.system('ALL extension features ready to activate based on their individual settings');
}

async function disableExtensionFunctionality() {
    Debug.system('Extension functionality disabled - disabling ALL features');
    
    // 1. Hide/remove all character cards (Full Character Cards feature)
    $('.bmt-character-cards').remove();
    $('.external-media-container').remove();
    $('.bmt-simple-indicator').remove(); // Simple indicators too
    Debug.system('All character displays removed');
    
    // 2. Hide WorldInfo UI (WorldInfo Integration feature)
    const panel = document.querySelector('.bmwi-panel');
    const trigger = document.querySelector('.bmwi-trigger');
    Debug.system(`WorldInfo elements found - panel: ${!!panel}, trigger: ${!!trigger}`);
    
    if (panel) {
        panel.style.display = 'none';
        Debug.system('WorldInfo panel hidden');
    }
    if (trigger) {
        trigger.style.display = 'none';
        Debug.system('WorldInfo icon hidden');
    }
    
    // Also try to hide via bunnyMoWorldInfoUI reference if it exists
    if (window.bunnyMoWorldInfoUI) {
        Debug.system('Hiding WorldInfo via bunnyMoWorldInfoUI object');
        if (window.bunnyMoWorldInfoUI.panel) {
            window.bunnyMoWorldInfoUI.panel.style.display = 'none';
        }
        if (window.bunnyMoWorldInfoUI.trigger) {
            window.bunnyMoWorldInfoUI.trigger.style.display = 'none';
        }
    }
    
    // 3. Disable AI Integration - trust SillyTavern's automatic ephemeral cleanup
    // Note: BunnyMoTags uses ephemeral=true injections which are automatically cleaned up
    // by SillyTavern after generation. Manual cleanup interferes with this system.
    Debug.system('AI injections use ephemeral=true and will be automatically cleaned up by SillyTavern');
    
    // 4. Remove any edit buttons (User Editing feature)
    $('.mes_reasoning_edit').remove();
    Debug.system('Edit buttons removed');
    
    // 5. Clear debug panel if it exists (Debug Mode feature)
    $('#bmt-debug-panel').remove();
    Debug.system('Debug panel cleared');
    
    Debug.system('ALL extension features disabled');
}

logSeq('Script loaded!');

// Utility functions for formatting
function formatTagType(tagType) {
    const typeMap = {
        'DERE': 'Personality',
        'SPECIES': 'Species', 
        'TRAIT': 'Traits',
        'BUILD': 'Build',
        'ORIENTATION': 'Orientation',
        'POWER': 'Power Dynamic',
        'ATTACHMENT': 'Attachment',
        'CHEMISTRY': 'Chemistry'
    };
    
    return typeMap[tagType] || tagType.charAt(0) + tagType.slice(1).toLowerCase();
}

function formatTagValue(value) {
    return value.split(' ').map(word => 
        word.charAt(0) + word.slice(1).toLowerCase()
    ).join(' ');
}

function setupBunnyMoThinkingBlockEvents(messageElement) {
    const thinkingBlock = messageElement.find('.bmt-thinking-block');
    
    // Copy functionality
    thinkingBlock.find('.mes_reasoning_copy').off('click').on('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        
        const reasoningContent = thinkingBlock.find('.mes_reasoning').text();
        if (reasoningContent) {
            navigator.clipboard.writeText(reasoningContent).then(() => {
                // Show toast notification if toastr is available
                if (typeof toastr !== 'undefined') {
                    toastr.success('BunnyMo tags copied to clipboard');
                }
            });
        }
    });
    
    // Edit functionality
    thinkingBlock.find('.mes_reasoning_edit').off('click').on('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        
        const reasoningContent = thinkingBlock.find('.mes_reasoning');
        const currentText = reasoningContent.html();
        
        // Create editable textarea
        const textarea = $(`
            <textarea class="mes_reasoning_editor" style="width: 100%; min-height: 100px; padding: 8px; border: 1px solid var(--SmartThemeBodyColor); background: var(--SmartThemeBlurTintColor); color: var(--SmartThemeBodyColor); font-family: var(--mainFontFamily); resize: vertical;">
                ${currentText.replace(/<br>/gi, '\n').replace(/<[^>]*>/g, '')}
            </textarea>
        `);
        
        reasoningContent.html(textarea);
        textarea.focus();
        
        // Show edit controls, hide normal ones
        thinkingBlock.addClass('editing');
        
        // Save edit
        thinkingBlock.find('.mes_reasoning_edit_done').off('click').on('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            
            const newContent = textarea.val().trim();
            if (newContent) {
                // Convert back to HTML format
                const htmlContent = newContent.split('\n').map(line => 
                    line.trim() ? line.trim() + '<br>' : '<br>'
                ).join('');
                
                reasoningContent.html(htmlContent);
            }
            
            // Restore normal controls
            thinkingBlock.removeClass('editing');
        });
        
        // Cancel edit
        thinkingBlock.find('.mes_reasoning_edit_cancel').off('click').on('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            
            reasoningContent.html(currentText);
            
            // Restore normal controls
            thinkingBlock.removeClass('editing');
        });
    });
    
    // Collapse all functionality  
    thinkingBlock.find('.mes_reasoning_close_all').off('click').on('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        
        $('.mes_reasoning_details[open]').each(function() {
            if (this !== thinkingBlock[0]) {
                this.open = false;
            }
        });
    });
    
    // Handle click on details element to prevent event conflicts
    thinkingBlock.off('click').on('click', function(e) {
        if (!e.target.closest('.mes_reasoning_actions') && !e.target.closest('.mes_reasoning_header')) {
            e.preventDefault();
        }
    });
}

// Clean any raw BunnyMo text that might interfere with display
function cleanRawBunnyMoFromMessage(message) {
    if (!message || !message.mes) return;
    
    // Remove any raw unformatted BunnyMo text that might appear in the message
    // This prevents duplicate/conflicting displays
    const patterns = [
        // Remove raw character data patterns
        /[A-Z\s]+:\s*\n(?:\s*-\s*[A-Za-z\s]+:.*\n?)+/g,
        // Remove BunnyMo tag patterns  
        /<BunnyMoTags>[\s\S]*?<\/BunnyMoTags>/g,
        // Remove any leftover formatting artifacts
        /\[CHARACTER CONTEXT.*?\]/g
    ];
    
    patterns.forEach(pattern => {
        message.mes = message.mes.replace(pattern, '').trim();
    });
}

// DOM + PERSISTENCE: Show and save exactly what was FORCE-FED to the AI
function displayInjectedCharacterDataWithPersistence(characterData, activeCharacters) {
    if (!chat || chat.length === 0) return;
    
    const lastMessage = chat[chat.length - 1];
    if (!lastMessage || lastMessage.is_user) return; // Only display on AI messages
    
    // Check if this message already has BunnyMo display to prevent conflicts
    const messageElements = $('#chat .mes');
    const targetMessage = messageElements.last();
    if (targetMessage.find('.bmt-thinking-block').length > 0) {
        logSeq(`⚠️ Message already has BunnyMo display - skipping to prevent conflict`);
        return;
    }
    
    logSeq(`🔥 DOM + PERSISTENCE: Displaying and saving force-fed data for ${activeCharacters.length} characters`);
    
    // 1. SAVE TO MESSAGE DATA (for persistence across refreshes)
    if (!lastMessage.extra) {
        lastMessage.extra = {};
    }
    if (!lastMessage.extra.bunnyMoData) {
        lastMessage.extra.bunnyMoData = [];
    }
    
    // Store the character data that was injected
    lastMessage.extra.bunnyMoData.push({
        timestamp: Date.now(),
        injectedData: characterData,
        characters: activeCharacters,
        depth: extension_settings[extensionName]?.injectionDepth ?? defaultSettings.injectionDepth,
        role: extension_settings[extensionName]?.injectionRole ?? defaultSettings.injectionRole
    });
    
    // 2. DOM DISPLAY (the approach that WORKED!)
    createDOMBunnyMoBlock(lastMessage, characterData, activeCharacters);
    
    logSeq(`✅ BunnyMo data saved to message AND displayed via DOM`);
}


// Create DOM block (the working approach!)
function createDOMBunnyMoBlock(message, characterData, activeCharacters) {
    // NEVER attach to user messages
    if (message.is_user) {
        logSeq('❌ Attempted to attach BunnyMo to user message - BLOCKED');
        return;
    }
    
    // Clean any raw BunnyMo text from the message first
    cleanRawBunnyMoFromMessage(message);
    
    // Find the message element in chat
    const messageElements = $('#chat .mes');
    let targetMessage = null;
    
    // Find the AI message element (never user messages)
    messageElements.each(function() {
        const isUserMessage = $(this).hasClass('user') || $(this).find('.name_text').text().toLowerCase().includes('you');
        if (isUserMessage) return; // Skip user messages
        
        const mesText = $(this).find('.mes_text, .mesBody, .message_body').text();
        if (mesText && mesText.includes(message.mes.substring(0, 50))) {
            targetMessage = $(this);
            return false; // break
        }
    });
    
    if (!targetMessage) {
        // Fallback to last AI message only
        messageElements.each(function() {
            const isUserMessage = $(this).hasClass('user') || $(this).find('.name_text').text().toLowerCase().includes('you');
            if (!isUserMessage) {
                targetMessage = $(this);
            }
        });
    }
    
    if (targetMessage.length === 0) {
        logSeq('❌ Could not find message element for DOM insertion');
        return;
    }
    
    // STRICT duplicate prevention - remove ALL BunnyMo blocks from this message
    targetMessage.find('.bmt-thinking-block').remove();
    
    // Also check for any reasoning blocks that might be ours
    targetMessage.find('.mes_reasoning_details').each(function() {
        if ($(this).find('.mes_reasoning_header_title').text().includes('BunnyMo')) {
            $(this).remove();
        }
    });
    
    // Create the thinking block HTML (WORKING APPROACH!)
    const thinkingBlockHTML = createBunnyMoThinkingBlockHTML(characterData, activeCharacters);
    
    // Insert using DOM (the approach that WORKED!)
    const mesBody = targetMessage.find('.mes_text, .mesBody, .message_body').first();
    if (mesBody.length > 0) {
        mesBody.prepend(thinkingBlockHTML);
        logSeq('✅ DOM insertion successful - BunnyMo block added to message body');
    } else {
        targetMessage.prepend(thinkingBlockHTML);
        logSeq('✅ DOM insertion successful - BunnyMo block added to message element');
    }
    
    // Add reasoning class and set up events
    targetMessage.addClass('reasoning');
    setupBunnyMoThinkingBlockEvents(targetMessage);
}

// Generate the thinking block HTML
function createBunnyMoThinkingBlockHTML(characterData, activeCharacters) {
    const settings = extension_settings[extensionName] || defaultSettings;
    const editButtonsHtml = settings.userEditable ? `
        <div class="mes_reasoning_edit_done menu_button edit_button fa-solid fa-check" 
             title="Confirm edit" style="display: none;"></div>
        <div class="mes_reasoning_edit_cancel menu_button edit_button fa-solid fa-xmark" 
             title="Cancel edit" style="display: none;"></div>
    ` : '';
    
    // Format the character data for display
    let displayContent = '';
    activeCharacters.forEach(charName => {
        displayContent += `<strong>${charName}:</strong><br>`;
        
        // Parse the character data to show individual tags
        const lines = characterData.split('\n');
        let inCharSection = false;
        
        for (const line of lines) {
            if (line.includes(charName + ':')) {
                inCharSection = true;
                continue;
            }
            
            if (inCharSection && line.startsWith('- ')) {
                const tagLine = line.substring(2).trim();
                displayContent += `• ${tagLine}<br>`;
            } else if (inCharSection && line.trim() && !line.startsWith('-')) {
                break; // End of this character
            }
        }
        displayContent += '<br>';
    });
    
    return `
        <details class="mes_reasoning_details bmt-thinking-block" open>
            <summary class="mes_reasoning_summary flex-container">
                <div class="mes_reasoning_header_block flex-container">
                    <div class="mes_reasoning_header flex-container">
                        <span class="mes_reasoning_header_title">🥕 BunnyMo Character Tags (FORCE-FED to AI)</span>
                        <div class="mes_reasoning_arrow fa-solid fa-chevron-up"></div>
                    </div>
                </div>
                <div class="mes_reasoning_actions flex-container">
                    <div class="mes_reasoning_copy mes_button fa-solid fa-copy" title="Copy BunnyMo tags"></div>
                    ${settings.userEditable ? '<div class="mes_reasoning_edit mes_button fa-solid fa-edit" title="Edit BunnyMo tags"></div>' : ''}
                    ${editButtonsHtml}
                    <div class="mes_reasoning_close_all mes_button fa-solid fa-minus" title="Collapse all reasoning blocks"></div>
                </div>
            </summary>
            <div class="mes_reasoning bmt-reasoning-content">
                ${displayContent}
            </div>
        </details>
    `;
}

// AUTO-DISPLAY: Show exactly what character data was FORCE-FED to the AI
function displayInjectedCharacterData(characterData, activeCharacters) {
    if (!chat || chat.length === 0) return;
    
    const lastMessage = chat[chat.length - 1];
    if (!lastMessage || lastMessage.is_user) return; // Only display on AI messages
    
    logSeq(`AUTO-DISPLAY: Showing what was force-fed to AI for ${activeCharacters.length} characters`);
    
    // Create BunnyMo data structure from the injected character data
    const bunnyMoData = [{
        characters: activeCharacters.map(charName => {
            // Parse the character data back into structured format
            const characterInfo = parseCharacterDataForDisplay(characterData, charName);
            return characterInfo;
        })
    }];
    
    // OLD system disabled - DOM + persistence handles everything now
    logSeq('⚠️ Old auto-display call skipped - DOM system handles this');
}

// Helper function to parse character data back into display format
function parseCharacterDataForDisplay(characterData, charName) {
    const lines = characterData.split('\n');
    let currentChar = null;
    
    for (const line of lines) {
        if (line.includes(charName + ':')) {
            currentChar = {
                name: charName,
                tags: new Map()
            };
            break;
        }
    }
    
    if (!currentChar) {
        // Fallback - create basic character structure
        return {
            name: charName,
            tags: new Map([['Info', new Set(['Character data was injected to AI'])]])
        };
    }
    
    // Parse the character's tag lines
    let inCharacterSection = false;
    for (const line of lines) {
        if (line.includes(charName + ':')) {
            inCharacterSection = true;
            continue;
        }
        
        if (inCharacterSection && line.startsWith('- ')) {
            const tagLine = line.substring(2).trim();
            const colonIndex = tagLine.indexOf(':');
            if (colonIndex > 0) {
                const tagType = tagLine.substring(0, colonIndex).trim();
                const tagValues = tagLine.substring(colonIndex + 1).trim();
                const valueSet = new Set(tagValues.split(',').map(v => v.trim()));
                currentChar.tags.set(tagType, valueSet);
            }
        } else if (inCharacterSection && line.trim() && !line.startsWith('-')) {
            // End of this character's section
            break;
        }
    }
    
    return currentChar;
}

// Parse <BunnyMoTags> content from message text (like <think> tags)
function parseBunnyMoFromMessage(messageContent) {
    const regex = /<BunnyMoTags>(.*?)<\/BunnyMoTags>/gs;
    const matches = messageContent.match(regex);
    
    if (matches) {
        const bunnyMoData = [];
        let cleanContent = messageContent;
        
        matches.forEach(match => {
            const content = match.replace(/<\/?BunnyMoTags>/g, '').trim();
            if (content) {
                bunnyMoData.push({
                    content: content,
                    characters: parseCharacterTags(content)
                });
            }
            // Remove the tags from visible content
            cleanContent = cleanContent.replace(match, '').trim();
        });
        
        return { bunnyMoData, cleanContent };
    }
    return null;
}

// Parse character tags from BunnyMo content
function parseCharacterTags(content) {
    const characters = [];
    const lines = content.split('\n');
    let currentChar = null;
    
    lines.forEach(line => {
        line = line.trim();
        if (!line) return;
        
        // Check if this is a character name line (ends with colon)
        if (line.endsWith(':')) {
            if (currentChar) {
                characters.push(currentChar);
            }
            currentChar = {
                name: line.slice(0, -1).trim(),
                tags: new Map()
            };
        } else if (currentChar && line.startsWith('- ')) {
            // This is a tag line
            const tagLine = line.substring(2).trim();
            const colonIndex = tagLine.indexOf(':');
            if (colonIndex > 0) {
                const tagType = tagLine.substring(0, colonIndex).trim();
                const tagValues = tagLine.substring(colonIndex + 1).trim().split(',').map(v => v.trim());
                currentChar.tags.set(tagType, new Set(tagValues));
            }
        }
    });
    
    // Don't forget the last character
    if (currentChar) {
        characters.push(currentChar);
    }
    
    return characters;
}

// Process <BunnyMoTags> content in messages (like <think> tag processing)
function processBunnyMoTagsInMessage(messageData) {
    if (!chat || chat.length === 0) return;
    
    // Get the last message (most recent)
    const message = chat[chat.length - 1];
    if (!message || !message.mes) return;
    
    // Only process AI messages, not user messages
    if (message.is_user === true) {
        logSeq('Skipping user message - BunnyMoTags only processes AI messages');
        return;
    }
    
    logSeq(`Processing AI message for BunnyMoTags: "${message.mes.substring(0, 100)}..."`);
    
    // Parse any <BunnyMoTags> content (like native thinking does)
    const parsed = parseBunnyMoFromMessage(message.mes);
    if (parsed && parsed.bunnyMoData.length > 0) {
        logSeq(`Found ${parsed.bunnyMoData.length} BunnyMoTags blocks - creating formatted display`);
        
        // Replace the raw content with formatted blocks (like native thinking)
        message.mes = parsed.cleanContent;
        
        // Create formatted blocks for each BunnyMo section
        parsed.bunnyMoData.forEach(data => {
            const characterData = data.content;
            const activeCharacters = data.characters.map(char => char.name);
            
            // Use DOM system to create permanent formatted blocks
            setTimeout(() => {
                createDOMBunnyMoBlock(message, characterData, activeCharacters);
            }, 100);
        });
        
        // Save to message extras for persistence
        if (!message.extra) {
            message.extra = {};
        }
        message.extra.bunnyMoData = parsed.bunnyMoData.map(data => ({
            timestamp: Date.now(),
            injectedData: data.content,
            characters: data.characters.map(char => char.name),
            source: 'ai_generated'
        }));
    }
}

// DISABLED: Old display system - DOM + persistence handles everything now
function displayBunnyMoFromMessageData(message, bunnyMoData) {
    logSeq('⚠️ Old display system called but DISABLED - using DOM + persistence instead');
    return;
    // Find the message element in the DOM - try multiple approaches
    const messageIndex = chat.indexOf(message);
    let messageElement = $(`.mes[mesid="${messageIndex}"]`);
    
    // If not found by mesid, try finding the last message
    if (messageElement.length === 0) {
        messageElement = $('#chat .mes').last();
        logSeq(`Could not find message by mesid="${messageIndex}", using last message instead`);
    }
    
    if (messageElement.length === 0) {
        logSeq('Could not find any message element to display BunnyMo block');
        return;
    }
    
    logSeq(`Displaying BunnyMo blocks for message ${messageIndex}, DOM element found: ${messageElement.length > 0}`);
    
    // Remove any existing BunnyMo blocks
    messageElement.find('.bmt-thinking-block').remove();
    
    bunnyMoData.forEach((data, index) => {
        // Build character info display
        let characterInfo = '';
        data.characters.forEach(char => {
            characterInfo += `<strong>${char.name}:</strong><br>`;
            
            // Validate that char.tags exists and is iterable
            if (char.tags && typeof char.tags[Symbol.iterator] === 'function') {
                for (const [tagType, tagValues] of char.tags) {
                    const displayType = formatTagType(tagType);
                    const displayValues = Array.from(tagValues).map(formatTagValue).join(', ');
                    characterInfo += `• ${displayType}: ${displayValues}<br>`;
                }
            } else if (char.tags && typeof char.tags === 'object') {
                // Handle case where tags is a plain object
                for (const [tagType, tagValues] of Object.entries(char.tags)) {
                    const displayType = formatTagType(tagType);
                    const displayValues = Array.isArray(tagValues) 
                        ? tagValues.map(formatTagValue).join(', ')
                        : formatTagValue(tagValues);
                    characterInfo += `• ${displayType}: ${displayValues}<br>`;
                }
            }
            characterInfo += '<br>';
        });
        
        // Check if editing is enabled
        const settings = extension_settings[extensionName] || defaultSettings;
        const editButtonsHtml = settings.userEditable ? `
            <div class="mes_reasoning_edit_done menu_button edit_button fa-solid fa-check" 
                 title="Confirm edit" style="display: none;"></div>
            <div class="mes_reasoning_edit_cancel menu_button edit_button fa-solid fa-xmark" 
                 title="Cancel edit" style="display: none;"></div>
            <div class="mes_reasoning_edit mes_button fa-solid fa-pencil" 
                 title="Edit BunnyMo tags"></div>
        ` : '';

        // Create the reasoning block
        const thinkingBlock = `
            <details class="mes_reasoning_details bmt-thinking-block" open>
                <summary class="mes_reasoning_summary flex-container">
                    <div class="mes_reasoning_header_block flex-container">
                        <div class="mes_reasoning_header flex-container">
                            <span class="mes_reasoning_header_title">🥕 BunnyMo Character Tags${settings.sendToAI ? ' (→ AI)' : ' (Display Only)'}</span>
                            <div class="mes_reasoning_arrow fa-solid fa-chevron-up"></div>
                        </div>
                    </div>
                    <div class="mes_reasoning_actions flex-container">
                        ${editButtonsHtml}
                        <div class="mes_reasoning_close_all mes_button fa-solid fa-minimize" 
                             title="Collapse all reasoning blocks"></div>
                        <div class="mes_reasoning_copy mes_button fa-solid fa-copy" 
                             title="Copy BunnyMo tags"></div>
                    </div>
                </summary>
                <div class="mes_reasoning bmt-reasoning-content">
                    ${characterInfo}
                </div>
            </details>
        `;
        
        // Try multiple selectors for message body
        let mesBody = messageElement.find('.mes_body');
        if (mesBody.length === 0) {
            mesBody = messageElement.find('.mesBody');
        }
        if (mesBody.length === 0) {
            mesBody = messageElement.find('.message_body');
        }
        if (mesBody.length === 0) {
            mesBody = messageElement.find('[class*="body"]');
        }
        
        logSeq(`Looking for message body in message ${messageIndex}, found: ${mesBody.length}`);
        if (mesBody.length > 0) {
            logSeq(`Message body selector: ${mesBody.attr('class')}`);
        }
        
        if (mesBody.length > 0) {
            // Insert at the very beginning to appear above everything
            mesBody.prepend(thinkingBlock);
            messageElement.addClass('reasoning');
            
            // Set up event handlers
            setupBunnyMoThinkingBlockEvents(messageElement);
            
            logSeq(`✅ BunnyMo reasoning block ${index + 1} added successfully to message ${messageIndex}`);
            
            // Force a visual refresh
            setTimeout(() => {
                const addedBlock = messageElement.find('.bmt-thinking-block');
                logSeq(`Verification: BunnyMo block exists in DOM: ${addedBlock.length > 0}`);
                if (addedBlock.length > 0) {
                    logSeq(`Block is visible: ${addedBlock.is(':visible')}`);
                    logSeq(`Block classes: ${addedBlock.attr('class')}`);
                }
            }, 200);
        } else {
            logSeq(`❌ Could not find message body in message ${messageIndex}`);
            logSeq(`Message element classes: ${messageElement.attr('class')}`);
            logSeq(`Message element structure: ${messageElement.html()?.substring(0, 300)}...`);
            
            // Fallback: try to insert at message level
            logSeq('⚠️ Attempting fallback insertion at message level');
            messageElement.prepend(thinkingBlock);
            messageElement.addClass('reasoning');
            setupBunnyMoThinkingBlockEvents(messageElement);
            logSeq('✅ Fallback insertion completed');
        }
    });
}

// Restore BunnyMo blocks from message data (PERSISTENCE!) - OPTIMIZED
function restoreBunnyMoBlocksFromMessageData() {
    if (!chat || chat.length === 0) return;
    
    // THROTTLE: Don't restore more than once every 2 seconds
    const now = Date.now();
    if (now - lastRestorationTime < 2000) {
        return;
    }
    lastRestorationTime = now;
    
    let restoredCount = 0;
    const messagesToProcess = [];
    
    // OPTIMIZATION: Only check messages that could need restoration
    chat.forEach((message, index) => {
        // Only restore for AI messages that have BunnyMo data
        if (message.is_user || !message.extra || !message.extra.bunnyMoData) return;
        
        // FAST CHECK: Look for existing blocks in DOM
        const messageElements = $('#chat .mes').eq(index);
        if (messageElements.find('.bmt-thinking-block').length > 0) {
            return; // Already displayed - SKIP
        }
        
        messagesToProcess.push({ message, index });
    });
    
    if (messagesToProcess.length === 0) {
        logSeq('✅ All BunnyMo blocks already displayed - no restoration needed');
        return;
    }
    
    logSeq(`📦 RESTORING: ${messagesToProcess.length} messages need BunnyMo blocks`);
    
    // Process in small batches to avoid performance issues
    messagesToProcess.forEach(({ message, index }, batchIndex) => {
        // Clean any raw BunnyMo text from saved messages
        cleanRawBunnyMoFromMessage(message);
        
        message.extra.bunnyMoData.forEach(bunnyData => {
            // Stagger restoration with smaller delays
            setTimeout(() => {
                createDOMBunnyMoBlock(message, bunnyData.injectedData, bunnyData.characters);
                restoredCount++;
            }, batchIndex * 50); // Faster restoration
        });
    });
    
    setTimeout(() => {
        if (restoredCount > 0) {
            logSeq(`✅ Restored ${restoredCount} BunnyMo blocks efficiently`);
        }
    }, messagesToProcess.length * 50 + 100);
}

// DISABLED: Old restore system - new optimized version handles everything
function restoreBunnyMoBlocks() {
    logSeq('⚠️ Old restore system called but DISABLED - using optimized restoration instead');
    return;
    if (!chat || chat.length === 0) return;
    
    logSeq(`Restoring BunnyMo blocks for ${chat.length} messages`);
    let restoredCount = 0;
    
    chat.forEach((message, index) => {
        if (message.extra && message.extra.bunnymo_data) {
            logSeq(`Found saved BunnyMo data in message ${index}`);
            
            // Find the message element in DOM
            const messageElement = $(`.mes[mesid="${index}"]`);
            if (messageElement.length > 0) {
                // Remove any existing BunnyMo blocks
                messageElement.find('.bmt-thinking-block').remove();
                
                // OLD system disabled - optimized restoration handles this
                logSeq('⚠️ Old restoration call skipped - using optimized system');
                restoredCount++;
            }
        }
    });
    
    logSeq(`Restored ${restoredCount} BunnyMo blocks from saved data`);
}

async function scanSelectedLorebooks(lorebookNames) {
    // Starting lorebook scan
    scannedCharacters.clear();
    tagPackEntries.clear();
    
    const foundCharacters = [];
    let tagEntriesCount = 0;
    let characterReposScanned = 0;
    let tagLibrariesScanned = 0;
    
    for (const lorebookName of lorebookNames) {
        try {
            const isCharacterRepo = characterRepoBooks.has(lorebookName);
            
            const lorebook = await loadWorldInfo(lorebookName);
            
            if (!lorebook || !lorebook.entries) {
                continue;
            }
            
            if (isCharacterRepo) {
                characterReposScanned++;
                // Scan for characters with names
                Object.values(lorebook.entries).forEach(entry => {
                    const characters = extractBunnyMoCharacters(entry, lorebookName);
                    characters.forEach(char => {
                        if (!scannedCharacters.has(char.name)) {
                            scannedCharacters.set(char.name, char);
                            foundCharacters.push(char.name);
                        }
                    });
                });
            } else {
                tagLibrariesScanned++;
                // Store tag pack entries for injection
                Object.values(lorebook.entries).forEach(entry => {
                    const content = entry.content || '';
                    const keys = entry.key || [];
                    const comment = entry.comment || '';
                    
                    // Store by all keywords that could match character tags
                    keys.forEach(key => {
                        const normalizedKey = key.toLowerCase().trim();
                        if (normalizedKey) {
                            tagPackEntries.set(normalizedKey, {
                                content: content,
                                keys: keys,
                                comment: comment,
                                source: lorebookName
                            });
                        }
                    });
                    
                    // Also try to extract tag names from comment
                    if (comment) {
                        const tagMatches = comment.match(/<([^>]+)>/g);
                        if (tagMatches) {
                            tagMatches.forEach(tag => {
                                const cleanTag = tag.replace(/[<>]/g, '').toLowerCase().trim();
                                if (cleanTag && !tagPackEntries.has(cleanTag)) {
                                    tagPackEntries.set(cleanTag, {
                                        content: content,
                                        keys: keys,
                                        comment: comment,
                                        source: lorebookName
                                    });
                                }
                            });
                        }
                    }
                    
                    tagEntriesCount++;
                });
            }
            
        } catch (error) {
            logSeq(`Error scanning ${lorebookName}: ${error.message}`);
        }
    }
    
    logSeq(`Scan complete: ${foundCharacters.length} characters, ${tagEntriesCount} tag entries`);
    
    return {
        characters: foundCharacters,
        characterRepos: characterReposScanned,
        tagLibraries: tagLibrariesScanned,
        tagEntries: tagEntriesCount
    };
}

function extractBunnyMoCharacters(entry, lorebookName) {
    const characters = [];
    const content = entry.content || '';
    
    // Look for BunnymoTags blocks
    const bunnyMoMatches = content.match(/<BunnymoTags>(.*?)<\/BunnymoTags>/gs);
    
    if (bunnyMoMatches) {
        bunnyMoMatches.forEach(match => {
            const tagContent = match.replace(/<\/?BunnymoTags>/g, '');
            const character = parseBunnyMoTagBlock(tagContent, lorebookName);
            
            if (character) {
                characters.push(character);
            }
        });
    }
    
    return characters;
}

function parseBunnyMoTagBlock(tagContent, lorebookName) {
    const tags = tagContent.split(',').map(t => t.trim());
    let characterName = null;
    const tagMap = new Map();
    
    tags.forEach(tag => {
        const tagMatch = tag.match(/<([^:>]+):([^>]+)>/);
        if (tagMatch) {
            const [, tagType, tagValue] = tagMatch;
            const cleanType = tagType.trim().toUpperCase();
            const cleanValue = tagValue.trim().toUpperCase().replace(/_/g, ' ');
            
            if (cleanType === 'NAME') {
                characterName = cleanValue.replace(/_/g, ' ');
            } else {
                if (!tagMap.has(cleanType)) {
                    tagMap.set(cleanType, new Set());
                }
                tagMap.get(cleanType).add(cleanValue);
            }
        }
    });
    
    if (characterName && tagMap.size > 0) {
        return {
            name: characterName,
            tags: tagMap,
            source: lorebookName
        };
    }
    
    return null;
}

function updateLorebookList() {
    const listElement = $('#bmt-lorebook-list');
    
    if (listElement.length === 0) {
        return;
    }
    
    let html = '';
    
    if (!world_names || world_names.length === 0) {
        html = '<p class="bmt-no-lorebooks">No lorebooks found. Create or import some lorebooks first.</p>';
    } else {
        
        world_names.forEach((lorebookName, index) => {
            const isSelected = selectedLorebooks.has(lorebookName);
            const isCharacterRepo = characterRepoBooks.has(lorebookName);
            const safeName = lorebookName.replace(/[^a-zA-Z0-9]/g, '_');
            
            html += `
            <div class="bmt-lorebook-item">
                <label>
                    <input type="checkbox" 
                           class="bmt-lorebook-checkbox" 
                           data-lorebook="${lorebookName}"
                           ${isSelected ? 'checked' : ''}>
                    <span class="bmt-lorebook-name">${lorebookName}</span>
                    <button class="bmt-char-repo-btn ${isCharacterRepo ? 'active' : ''}" 
                            data-lorebook="${lorebookName}"
                            title="Mark as Character Repository">
                        ${isCharacterRepo ? '👤' : '📚'}
                    </button>
                    <span class="bmt-lorebook-status bmt-status-empty" id="bmt-status-${safeName}">
                        ${isCharacterRepo ? 'Character Repo' : 'Tag Library'}
                    </span>
                </label>
            </div>`;
        });
        
    }
    
    listElement.html(html);
    
    // Add change listeners
    $('.bmt-lorebook-checkbox').off('change').on('change', async function() {
        const lorebookName = $(this).data('lorebook');
        
        if (this.checked) {
            selectedLorebooks.add(lorebookName);
            console.log('[BMT SETTINGS] Selected lorebook:', lorebookName);
        } else {
            selectedLorebooks.delete(lorebookName);
            console.log('[BMT SETTINGS] Deselected lorebook:', lorebookName);
        }
        
        saveSettings();
        
        // Reload templates when lorebook selection changes
        await onLorebookSelectionChange();
    });
    
    // Add character repo button listeners
    $('.bmt-char-repo-btn').off('click').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const lorebookName = $(this).data('lorebook');
        const isCurrentlyRepo = characterRepoBooks.has(lorebookName);
        
        if (isCurrentlyRepo) {
            characterRepoBooks.delete(lorebookName);
            $(this).removeClass('active').text('📚');
            $(this).siblings('.bmt-lorebook-status').text('Tag Library');
            console.log('[BMT SETTINGS] Unmarked as character repo:', lorebookName);
        } else {
            characterRepoBooks.add(lorebookName);
            $(this).addClass('active').text('👤');
            $(this).siblings('.bmt-lorebook-status').text('Character Repo');
            console.log('[BMT SETTINGS] Marked as character repo:', lorebookName);
        }
        
        saveSettings();
    });
    
    // Add search functionality
    $('#bmt-search-lorebooks').off('input').on('input', function() {
        const searchTerm = $(this).val().toLowerCase();
        $('.bmt-lorebook-item').each(function() {
            const lorebookName = $(this).find('.bmt-lorebook-name').text().toLowerCase();
            if (lorebookName.includes(searchTerm)) {
                $(this).show();
            } else {
                $(this).hide();
            }
        });
    });
    
}

jQuery(async () => {
    try {
        // Load saved settings first
        loadSettings();
        
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $('#extensions_settings').append(settingsHtml);
        
        
        // Set up professional settings system
        setTimeout(() => {
            initializeProfessionalSettings();
        }, 1000);
        
        // Professional Settings System Initialization
        function initializeProfessionalSettings() {
            logSeq('🚀 Initializing professional settings system');
            
            // Call the lorebook list updater
            updateLorebookList();
            
            // Load current settings into UI
            const currentSettings = extension_settings[extensionName] || defaultSettings;
            loadSettingsIntoUI(currentSettings);
            
            // Set up all event handlers
            setupSettingsEventHandlers();
            
            // Set up automatic character detection
            setupAutoCharacterDetection();
            
            // Update status display
            updateStatusDisplay();
        }
        
        function loadSettingsIntoUI(settings) {
            logSeq('📋 Loading settings into professional UI');
            
            // Feature Controls
            $('#bmt-enabled').prop('checked', settings.enabled ?? defaultSettings.enabled);
            $('#bmt-send-to-ai').prop('checked', settings.sendToAI ?? defaultSettings.sendToAI);
            $('#bmt-use-card-display').prop('checked', settings.useCardDisplay ?? defaultSettings.useCardDisplay);
            $('#bmt-worldinfo-enabled').prop('checked', settings.worldinfoEnabled ?? true);
            $('#bmt-global-scan-depth').val(settings.globalScanDepth ?? 0);
            $('#bmt-global-scan-depth-value').text(settings.globalScanDepth ?? 0);
            $('#bmt-user-editable').prop('checked', settings.userEditable ?? defaultSettings.userEditable);
            $('#bmt-debug').prop('checked', settings.debugMode ?? defaultSettings.debugMode);
            
            // AI Integration
            if (settings.injectionPrompt) {
                updatePromptPreview('Using custom injection template');
            } else {
                updatePromptPreview('Using default BunnyMo injection template');
            }
            
            const depth = settings.injectionDepth ?? defaultSettings.injectionDepth;
            const role = settings.injectionRole ?? defaultSettings.injectionRole;
            $('#bmt-injection-depth').val(depth);
            $('#bmt-depth-value').text(depth);
            $('#bmt-injection-role').val(role);
            
            // Display Settings
            $('#bmt-sensitivity').val(settings.characterDetectionSensitivity ?? defaultSettings.characterDetectionSensitivity);
            $('#bmt-max-chars').val(settings.maxCharactersShown ?? defaultSettings.maxCharactersShown);
            $('#bmt-auto-hide').prop('checked', settings.autoHideEmpty ?? defaultSettings.autoHideEmpty);
            
            
            // Token Optimization
            $('#bmt-ai-use-compact-format').prop('checked', settings.aiUseCompactFormat ?? defaultSettings.aiUseCompactFormat);
            $('#bmt-ai-max-characters').val(settings.aiMaxCharacters ?? defaultSettings.aiMaxCharacters);
            $('#bmt-ai-max-characters-value').text(settings.aiMaxCharacters ?? defaultSettings.aiMaxCharacters);
            $('#bmt-ai-priority-tags').val((settings.aiPriorityTags || defaultSettings.aiPriorityTags).join(','));
            
            // Update UI states based on toggles
            updateUIStates();
        }
        
        function setupSettingsEventHandlers() {
            logSeq('🔧 Setting up professional event handlers');
            
            // Modal system
            setupModalSystem();
            
            // Lorebook Management
            $('#bmt-scan-btn').off('click').on('click', handleLorebookScan);
            $('#bmt-test-display').off('click').on('click', () => {
                logSeq('🧪 Test display clicked');
                showTestCharacterInsights();
            });
            
            // Feature Controls Event Handlers
            $('#bmt-enabled').off('change').on('change', function() {
                const enabled = this.checked;
                updateSetting('enabled', enabled);
                Debug.settings(`Master Enable toggled to: ${enabled}`);
                
                if (enabled) {
                    Debug.system('Extension ENABLED - reactivating all functionality');
                    // Re-enable all extension functionality
                    enableExtensionFunctionality();
                } else {
                    Debug.system('Extension DISABLED - deactivating all functionality');
                    // Disable all extension functionality
                    disableExtensionFunctionality();
                }
                
                updateUIStates();
            });
            
            $('#bmt-send-to-ai').off('change').on('change', function() {
                const enabled = this.checked;
                updateSetting('sendToAI', enabled);
                Debug.settings(`AI Integration toggled to: ${enabled}`);
                
                if (enabled) {
                    Debug.ai('AI context injection ENABLED - character data will be sent to AI');
                } else {
                    Debug.ai('AI context injection DISABLED - character data shown for display only');
                }
            });
            
            $('#bmt-use-card-display').off('change').on('change', function() {
                const enabled = this.checked;
                updateSetting('useCardDisplay', enabled);
                updateUIStates();
                Debug.settings(`Full Character Cards toggled to: ${enabled}`);
                
                if (enabled) {
                    Debug.cards('Full character cards ENABLED - displaying interactive cards');
                    // Remove any existing simple indicators
                    $('.bmt-simple-indicator').remove();
                } else {
                    Debug.cards('Full character cards DISABLED - showing simple 🥕 indicators only');
                    // Remove any existing full cards
                    $('.bmt-character-cards').remove();
                    $('.external-media-container').remove();
                }
            });
            
            $('#bmt-worldinfo-enabled').off('change').on('change', function() {
                Debug.settings(`WorldInfo toggle changed to: ${this.checked}`);
                Debug.settings(`Scanned characters available: ${scannedCharacters.size}`);
                Debug.settings(`Current bunnyMoWorldInfoUI exists: ${!!bunnyMoWorldInfoUI}`);
                
                updateSetting('worldinfoEnabled', this.checked);
                logSeq(`WorldInfo integration ${this.checked ? 'enabled' : 'disabled'}`);
                
                // Hide/show WorldInfo UI immediately when setting changes
                if (this.checked) {
                    Debug.settings('WorldInfo ENABLED - attempting to show UI');
                    
                    // Check if we have any enabled lorebooks in the system
                    const enabledLorebooks = getEnabledLorebooks();
                    Debug.settings(`Found ${enabledLorebooks.length} enabled lorebooks in system`);
                    
                    if (enabledLorebooks.length > 0) {
                        Debug.settings(`Found ${scannedCharacters.size} scanned characters`);
                        Debug.settings('Scanned characters', Array.from(scannedCharacters.keys()));
                        
                        // Check CSS
                        const existingCSS = document.getElementById('bmwi-styles');
                        Debug.settings(`Existing WorldInfo CSS: ${!!existingCSS}`);
                        
                        if (!existingCSS) {
                            Debug.settings('Loading WorldInfo CSS...');
                            const worldInfoLink = document.createElement('link');
                            worldInfoLink.id = 'bmwi-styles';
                            worldInfoLink.rel = 'stylesheet';
                            worldInfoLink.type = 'text/css';
                            worldInfoLink.href = `${extensionFolderPath}/worldinfo.css`;
                            document.head.appendChild(worldInfoLink);
                            Debug.settings('Added WorldInfo CSS link');
                        }
                        
                        Debug.settings('Calling initBunnyMoWorldInfo...');
                        Debug.settings('About to call initBunnyMoWorldInfo with enabled lorebooks', enabledLorebooks);
                        
                        try {
                            // Pass scannedCharacters if available, otherwise create empty map for WorldInfo to work with enabled lorebooks
                            const charactersForWorldInfo = scannedCharacters.size > 0 ? scannedCharacters : new Map();
                            bunnyMoWorldInfoUI = initBunnyMoWorldInfo(charactersForWorldInfo);
                            Debug.settings(`initBunnyMoWorldInfo returned: ${!!bunnyMoWorldInfoUI}`);
                            Debug.settings('initBunnyMoWorldInfo result', bunnyMoWorldInfoUI);
                            
                            // Check if both panel and icon exist in DOM and show them
                            const panel = document.querySelector('.bmwi-panel');
                            const trigger = document.querySelector('.bmwi-trigger');
                            
                            Debug.settings(`WorldInfo panel in DOM: ${!!panel}`);
                            Debug.settings(`WorldInfo trigger in DOM: ${!!trigger}`);
                            
                            if (panel) {
                                Debug.settings(`Panel display style: ${panel.style.display}`);
                                Debug.settings(`Panel visibility: ${getComputedStyle(panel).visibility}`);
                                Debug.settings(`Panel has bmwi-active class: ${panel.classList.contains('bmwi-active')}`);
                                
                                // Don't force panel open - let it start collapsed as an icon
                                // The user can click the trigger to open it if needed
                                panel.classList.remove('bmwi-active'); // Ensure it starts closed
                                Debug.settings('WorldInfo panel is ready but starts collapsed');
                            }
                            
                            if (trigger) {
                                Debug.settings(`Trigger display style: ${trigger.style.display}`);
                                trigger.style.display = 'block'; // Force show
                                Debug.settings('Forced WorldInfo icon to display block');
                            }
                            
                            // Also show via bunnyMoWorldInfoUI reference if it exists
                            if (bunnyMoWorldInfoUI) {
                                Debug.settings('Showing via bunnyMoWorldInfoUI object', bunnyMoWorldInfoUI);
                                if (bunnyMoWorldInfoUI.panel) {
                                    bunnyMoWorldInfoUI.panel.style.display = 'block';
                                    Debug.settings('Panel shown via UI object');
                                }
                                if (bunnyMoWorldInfoUI.trigger) {
                                    bunnyMoWorldInfoUI.trigger.style.display = 'block';
                                    Debug.settings('Trigger shown via UI object');
                                }
                            }
                            
                            logSeq('✅ WorldInfo UI reinitialized');
                        } catch (error) {
                            Debug.error(`Error initializing WorldInfo: ${error.message}`);
                            Debug.error('initBunnyMoWorldInfo failed', error);
                        }
                    } else {
                        Debug.settings('No enabled lorebooks found in SillyTavern');
                        Debug.settings('SOLUTION: Enable some lorebooks in SillyTavern\'s World Info system first');
                        
                        // Show user a helpful message
                        const alertMsg = 'WorldInfo Integration enabled, but no lorebooks are currently enabled in SillyTavern.\n\n' +
                                       'To use WorldInfo features:\n' +
                                       '1. Go to SillyTavern\'s World Info tab\n' +
                                       '2. Enable some lorebooks there\n' +
                                       '3. Then the BunnyMo WorldInfo UI will appear';
                        
                        setTimeout(() => alert(alertMsg), 100);
                    }
                } else {
                    Debug.settings('WorldInfo DISABLED - hiding UI');
                    Debug.settings('WorldInfo disabled - hiding both panel and icon');
                    
                    // Hide both WorldInfo panel AND icon
                    const panel = document.querySelector('.bmwi-panel');
                    const trigger = document.querySelector('.bmwi-trigger');
                    
                    Debug.settings(`Found panel to hide: ${!!panel}`);
                    Debug.settings(`Found trigger/icon to hide: ${!!trigger}`);
                    
                    if (panel) {
                        panel.style.display = 'none';
                        Debug.settings('WorldInfo panel hidden');
                        Debug.settings('Panel hidden - display set to none');
                    }
                    
                    if (trigger) {
                        trigger.style.display = 'none';
                        Debug.settings('WorldInfo icon hidden');
                        Debug.settings('Icon/trigger hidden - display set to none');
                    }
                    
                    // Also try to hide by bunnyMoWorldInfoUI reference if it exists
                    if (bunnyMoWorldInfoUI) {
                        Debug.settings('Hiding via bunnyMoWorldInfoUI object', bunnyMoWorldInfoUI);
                        if (bunnyMoWorldInfoUI.panel) {
                            bunnyMoWorldInfoUI.panel.style.display = 'none';
                            Debug.settings('Panel hidden via UI object');
                        }
                        if (bunnyMoWorldInfoUI.trigger) {
                            bunnyMoWorldInfoUI.trigger.style.display = 'none';
                            Debug.settings('Trigger hidden via UI object');
                        }
                    }
                    
                    // Clear the UI reference
                    bunnyMoWorldInfoUI = null;
                    logSeq('🔇 WorldInfo UI (panel + icon) hidden');
                }
            });
            
            $('#bmt-user-editable').off('change').on('change', function() {
                const enabled = this.checked;
                updateSetting('userEditable', enabled);
                Debug.settings(`User Editing toggled to: ${enabled}`);
                
                if (enabled) {
                    Debug.settings('Edit buttons ENABLED - users can edit BunnyMo blocks in chat');
                } else {
                    Debug.settings('Edit buttons DISABLED - BunnyMo blocks are read-only');
                    // Remove any existing edit buttons from current display
                    $('.mes_reasoning_edit').remove();
                }
            });
            
            $('#bmt-debug').off('change').on('change', function() {
                const enabled = this.checked;
                updateSetting('debugMode', enabled);
                
                if (enabled) {
                    // Test debug output immediately
                    console.log('[BMT SETTINGS] ⚙️ Debug Mode ENABLED - detailed console logging active');
                    Debug.system('Debug mode activated - you will now see detailed console output');
                    Debug.settings('All debug categories active: SYSTEM, CARDS, AI, SETTINGS, EVENTS, ERROR');
                } else {
                    // Final message before disabling
                    console.log('[BMT SETTINGS] ⚙️ Debug Mode DISABLED - console logging stopped');
                }
                
                // This uses logSeq which bypasses the debug system  
                logSeq(`🐛 Debug mode ${enabled ? 'enabled' : 'disabled'}`);
            });
            
            // AI Integration Event Handlers
            $('#bmt-injection-depth').off('input').on('input', function() {
                const depth = parseInt(this.value);
                $('#bmt-depth-value').text(depth);
                updateSetting('injectionDepth', depth);
                logSeq(`🔥 Injection depth set to: ${depth} (Lower = HIGHER PRIORITY!)`);
            });
            
            $('#bmt-injection-role').off('change').on('change', function() {
                updateSetting('injectionRole', this.value);
                logSeq(`⚡ Injection role set to: ${this.value}`);
            });
            
            // Display Settings Event Handlers
            $('#bmt-sensitivity').off('change').on('change', function() {
                updateSetting('characterDetectionSensitivity', this.value);
                logSeq(`🔍 Detection sensitivity set to: ${this.value}`);
            });
            
            $('#bmt-max-chars').off('input').on('input', function() {
                updateSetting('maxCharactersShown', parseInt(this.value));
                logSeq(`📊 Max characters set to: ${this.value}`);
            });
            
            $('#bmt-auto-hide').off('change').on('change', function() {
                updateSetting('autoHideEmpty', this.checked);
                logSeq(`🔄 Auto-hide set to: ${this.checked}`);
            });
            
            
            // Token Optimization Event Handlers
            $('#bmt-ai-use-compact-format').off('change').on('change', function() {
                updateSetting('aiUseCompactFormat', this.checked);
                logSeq(`⚡ Compact AI format ${this.checked ? 'enabled' : 'disabled'}`);
            });
            
            $('#bmt-ai-max-characters').off('input').on('input', function() {
                const value = parseInt(this.value);
                $('#bmt-ai-max-characters-value').text(value);
                updateSetting('aiMaxCharacters', value);
                logSeq(`📊 AI max characters set to: ${value}`);
            });
            
            $('#bmt-global-scan-depth').off('input').on('input', function() {
                const value = parseInt(this.value);
                $('#bmt-global-scan-depth-value').text(value);
                updateSetting('globalScanDepth', value);
                logSeq(`🎰 Global scan depth set to: ${value === 0 ? 'disabled (use individual entry settings)' : value}`);
            });
            
            $('#bmt-ai-priority-tags').off('change').on('change', function() {
                const tags = this.value.split(',').map(t => t.trim()).filter(t => t);
                updateSetting('aiPriorityTags', tags);
                logSeq(`🏷️ Priority tags set to: ${tags.join(', ')}`);
            });
        }
        
        function setupModalSystem() {
            logSeq('🪟 Setting up modal system');
            
            // Initialize template prompt edit interface
            if (!templatePromptEditInterface) {
                templatePromptEditInterface = new TemplatePromptEditInterface();
                logSeq('🎯 Template prompt edit interface initialized');
            }
            
            // Template edit button - like qvink_memory
            $('#edit_template_prompt').off('click').on('click', () => {
                logSeq(`✏️ Opening template editor`);
                templatePromptEditInterface.selectedTemplate = null; // Let user select in modal
                templatePromptEditInterface.show();
            });
            
            // Edit prompt button
            $('#bmt-edit-prompt').off('click').on('click', () => {
                logSeq('✏️ Opening prompt editor modal');
                $('#bmt-prompt-editor-modal').show();
                
                // Load current prompt into modal
                const currentSettings = extension_settings[extensionName] || defaultSettings;
                const currentPrompt = currentSettings.injectionPrompt || getDefaultPrompt();
                $('#bmt-prompt-editor-modal #bmt-injection-prompt').val(currentPrompt);
            });
            
            // Close modal
            $('#bmt-close-prompt-editor, #bmt-prompt-editor-modal .bmt-modal-overlay').off('click').on('click', () => {
                $('#bmt-prompt-editor-modal').hide();
            });
            
            // Prevent modal content clicks from closing modal
            $('#bmt-prompt-editor-modal .bmt-modal-content').off('click').on('click', (e) => {
                e.stopPropagation();
            });
            
            // Macro insertion
            $('.bmt-macro-item').off('click').on('click', function() {
                const macro = $(this).data('macro');
                const textarea = $('#bmt-prompt-editor-modal #bmt-injection-prompt')[0];
                const cursorPos = textarea.selectionStart;
                const textBefore = textarea.value.substring(0, cursorPos);
                const textAfter = textarea.value.substring(textarea.selectionEnd);
                
                textarea.value = textBefore + macro + textAfter;
                textarea.selectionStart = textarea.selectionEnd = cursorPos + macro.length;
                textarea.focus();
                logSeq(`📝 Inserted macro: ${macro}`);
            });
            
            // Modal buttons
            $('#bmt-save-prompt').off('click').on('click', () => {
                const promptText = $('#bmt-prompt-editor-modal #bmt-injection-prompt').val();
                updateSetting('injectionPrompt', promptText);
                updatePromptPreview(promptText ? 'Using custom injection template' : 'Using default BunnyMo injection template');
                $('#bmt-prompt-editor-modal').hide();
                logSeq('💾 Custom prompt saved');
            });
            
            $('#bmt-reset-prompt').off('click').on('click', () => {
                const defaultPrompt = getDefaultPrompt();
                $('#bmt-prompt-editor-modal #bmt-injection-prompt').val(defaultPrompt);
                logSeq('🔄 Prompt reset to default');
            });
            
            $('#bmt-preview-prompt').off('click').on('click', () => {
                const promptText = $('#bmt-prompt-editor-modal #bmt-injection-prompt').val();
                let previewText = promptText
                    .replace(/\{\{CHARACTER_DATA\}\}/g, '[Character data would appear here]')
                    .replace(/\{\{CHARACTER_NAMES\}\}/g, 'Alice, Bob, Charlie')
                    .replace(/\{\{CHARACTER_COUNT\}\}/g, '3')
                    .replace(/\{\{PRIORITY_TRAITS\}\}/g, 'Kind, Intelligent, Brave');
                
                alert('Preview of injection prompt:\n\n' + previewText);
                logSeq('👁️ Prompt preview shown');
            });
        }
        
        function updatePromptPreview(text) {
            $('#bmt-prompt-summary-text').text(text);
        }
        
        function getDefaultPrompt() {
            // Use template system if available, otherwise fallback
            if (templateManager) {
                return templateManager.getTemplate('characterInjectionDefault')?.content || getFallbackPrompt();
            }
            return getFallbackPrompt();
        }
        
        function getFallbackPrompt() {
            return `[MANDATORY CHARACTER CONTEXT - Process Before Generating]

The following characters are active in this conversation. You MUST acknowledge and incorporate their traits, personality, and characteristics in your response:

{{CHARACTER_DATA}}

This character information takes PRIORITY over other context. Ensure your response is consistent with these established character traits and behaviors.`;
        }
        
        function updateSetting(key, value) {
            if (!extension_settings[extensionName]) {
                extension_settings[extensionName] = {};
            }
            extension_settings[extensionName][key] = value;
            saveSettings();
        }
        
        function updateUIStates() {
            const settings = extension_settings[extensionName] || defaultSettings;
            const masterEnabled = settings.enabled;
            
            Debug.settings(`Updating UI states - Master Enable: ${masterEnabled}`);
            
            // If Master Enable is off, disable ALL other controls (like qvink_memory does)
            if (masterEnabled) {
                // Enable all controls
                $('.bmt-extension-settings input, .bmt-extension-settings select, .bmt-extension-settings textarea').not('#bmt-enabled').prop('disabled', false);
                $('.bmt-extension-settings .bmt-setting-item, .bmt-extension-settings .bmt-form-group').removeClass('bmt-disabled-section');
                Debug.settings('All settings controls enabled');
                
                // Show/hide card theme section based on card display toggle
                if (settings.useCardDisplay) {
                    $('#bmt-card-theme-section').removeClass('disabled');
                } else {
                    $('#bmt-card-theme-section').addClass('disabled');
                }
                
            } else {
                // Disable ALL other controls except Master Enable
                $('.bmt-extension-settings input, .bmt-extension-settings select, .bmt-extension-settings textarea').not('#bmt-enabled').prop('disabled', true);
                $('.bmt-extension-settings .bmt-setting-item, .bmt-extension-settings .bmt-form-group').not(':has(#bmt-enabled)').addClass('bmt-disabled-section');
                Debug.settings('All settings controls disabled - Master Enable is OFF');
                
                // When master disabled, disable the whole card theme section
                $('#bmt-card-theme-section').addClass('disabled');
            }
        }
        
        
        async function handleLorebookScan() {
            const selected = Array.from(selectedLorebooks);
            if (selected.length === 0) {
                alert('No lorebooks selected. Please select at least one lorebook to scan.');
                return;
            }
            
            // Actually scan the selected lorebooks
            $('#bmt-scan-btn').text('Scanning...');
            const results = await scanSelectedLorebooks(selected);
            $('#bmt-scan-btn').text('Scan Selected Lorebooks');
            
            updateStatusDisplay();
            
            let message = `Scan Results:\n\n`;
            message += `📚 Tag Libraries: ${results.tagLibraries} (${results.tagEntries} tag entries)\n`;
            message += `👤 Character Repos: ${results.characterRepos}\n`;
            message += `🎭 Characters Found: ${results.characters.length}\n\n`;
            
            if (results.characters.length > 0) {
                message += `Characters:\n${results.characters.join('\n')}`;
            } else {
                message += `No characters found. Try marking lorebooks as Character Repos (👤) first.`;
            }
            
            alert(message);
        }
        
        
        function updateStatusDisplay() {
            const statusElement = $('#bmt-status');
            if (statusElement.length === 0) return;
            
            const selectedBooks = selectedLorebooks.size;
            const charactersFound = scannedCharacters.size;
            const characterNames = Array.from(scannedCharacters.keys());
            
            // Get lorebook enabled/disabled status for characters
            let enabledCharacters = 0;
            let disabledCharacters = 0;
            
            // Check character status against world_info entries
            if (typeof world_info !== 'undefined' && world_info && world_info.globalSelect) {
                const worldEntries = world_info.globalSelect;
                characterNames.forEach(charName => {
                    const entry = worldEntries.find(e => 
                        e.comment && e.comment.toLowerCase().includes(charName.toLowerCase()) ||
                        (e.key && Array.isArray(e.key) && e.key.some(k => k.toLowerCase().includes(charName.toLowerCase())))
                    );
                    if (entry) {
                        if (entry.disable === true) {
                            disabledCharacters++;
                        } else {
                            enabledCharacters++;
                        }
                    }
                });
            } else {
                // Fallback if world_info isn't available
                enabledCharacters = charactersFound;
            }
            
            let html = `
            <div class="status-item">
                <span class="status-label">Status:</span>
                <span class="status-value">Active and Ready</span>
            </div>
            <div class="status-item">
                <span class="status-label">Selected Lorebooks:</span>
                <span class="status-value">${selectedBooks}</span>
            </div>
            <div class="status-item">
                <span class="status-label">Characters Found:</span>
                <span class="status-value">${charactersFound}</span>
            </div>
            `;
            
            if (charactersFound > 0) {
                html += `
                <div class="status-item">
                    <span class="status-label">📗 Enabled Characters:</span>
                    <span class="status-value" style="color: #4ade80;">${enabledCharacters}</span>
                </div>`;
                
                if (disabledCharacters > 0) {
                    html += `
                    <div class="status-item">
                        <span class="status-label">📕 Disabled Characters:</span>
                        <span class="status-value" style="color: #f87171;">${disabledCharacters}</span>
                    </div>`;
                }
                
                html += `
                <div class="status-item">
                    <span class="status-label">Active Characters:</span>
                    <span class="status-value">${characterNames.slice(0, 3).join(', ')}${characterNames.length > 3 ? '...' : ''}</span>
                </div>`;
            }
            
            statusElement.html(html);
        }
        
        async function injectCharacterTags() {
            if (!isEnabled()) {
                Debug.system('Extension disabled - skipping character tag injection');
                return;
            }
            // Check if AI injection is enabled
            const settings = extension_settings[extensionName] || defaultSettings;
            logSeq(`Card-based injection check: sendToAI=${settings.sendToAI}, useCardDisplay=${settings.useCardDisplay}`);
            
            if (!settings.sendToAI) {
                logSeq('AI injection disabled by user settings');
                return;
            }
            
            // NEW CARD SYSTEM: Use the card-based approach if enabled
            if (settings.useCardDisplay !== false) {
                logSeq('🎴 Switching to CARD-BASED injection system');
                return injectCharacterTagsCardBased();
            }
            
            // LEGACY SYSTEM: Continue with old approach
            logSeq('📋 Using legacy DOM system (card display disabled)');
            
            logSeq('Starting mandatory BunnyMo character injection');
            
            // Get the current message being generated
            const currentMessage = chat ? chat[chat.length - 1] : null;
            
            // Skip if we already processed this message
            if (currentMessage && lastProcessedMessage === currentMessage) {
                return;
            }
            
            if (scannedCharacters.size === 0) {
                return;
            }
            
            // Mark this message as processed
            lastProcessedMessage = currentMessage;
            
            const recentMessages = chat ? chat.slice(-10) : [];
            const activeCharacters = [];
            
            // Detect active characters from recent messages (skip BunnyMo system messages)
            recentMessages.forEach(msg => {
                // Skip BunnyMo system messages to avoid infinite loops
                if (msg.name === 'BunnyMoTags') {
                    return;
                }
                
                // Check message sender
                if (msg.name && scannedCharacters.has(msg.name)) {
                    if (!activeCharacters.includes(msg.name)) {
                        activeCharacters.push(msg.name);
                    }
                }
                
                // Check message content for character mentions  
                if (msg.mes) {
                    const messageText = msg.mes.toLowerCase();
                    for (const charName of scannedCharacters.keys()) {
                        const nameLower = charName.toLowerCase();
                        
                        // Split character name into words and check if any word appears in message
                        const nameWords = nameLower.split(' ');
                        let found = false;
                        
                        for (const word of nameWords) {
                            if (word.length > 2 && messageText.includes(word)) { // Skip short words like "al", "ibn"
                                found = true;
                                break;
                            }
                        }
                        
                        if (found && !activeCharacters.includes(charName)) {
                            activeCharacters.push(charName);
                        }
                    }
                }
            });
            
            if (activeCharacters.length === 0) {
                return;
            }
            
            // Build character data for injection
            let characterData = '';
            let tagPackData = '';
            const relevantTags = new Set();
            
            activeCharacters.forEach(charName => {
                const charData = scannedCharacters.get(charName);
                if (charData) {
                    characterData += `${charName}:\n`;
                    for (const [tagType, tagValues] of charData.tags) {
                        const displayValues = Array.from(tagValues).join(', ');
                        characterData += `- ${tagType}: ${displayValues}\n`;
                        
                        // Collect all tag values to find matching tag pack entries
                        tagValues.forEach(tagValue => {
                            const normalizedTag = tagValue.toLowerCase().trim();
                            relevantTags.add(normalizedTag);
                        });
                    }
                    characterData += '\n';
                }
            });
            
            // Add relevant tag pack entries
            if (relevantTags.size > 0) {
                relevantTags.forEach(tag => {
                    const tagEntry = tagPackEntries.get(tag);
                    if (tagEntry) {
                        tagPackData += `\n[${tag.toUpperCase()} DEFINITION]\n${tagEntry.content}\n`;
                    }
                });
            }
            
            // Combine character data and tag pack data
            const fullCharacterData = characterData + tagPackData;
            
            // Create mandatory injection text using template system
            let injectionText;
            if (templateManager) {
                const template = templateManager.getTemplate('characterInjectionDefault');
                if (template) {
                    injectionText = templateManager.renderTemplate('characterInjectionDefault', {
                        CHARACTER_DATA: fullCharacterData.trim()
                    });
                } else {
                    // Fallback if template not found
                    injectionText = createFallbackInjection(fullCharacterData.trim());
                }
            } else {
                // Fallback if template manager not available
                injectionText = createFallbackInjection(fullCharacterData.trim());
            }
            
            logSeq(`Mandatory injection for: ${activeCharacters.join(', ')}`);
            
            // Use the /inject slash command with HIGH PRIORITY depth (DUAL-FIRING COT)
            const context = getContext();
            if (context && context.executeSlashCommandsWithOptions) {
                // Note: No manual cleanup needed - ephemeral injections are automatically cleaned up
                
                const settings = extension_settings[extensionName] || defaultSettings;
                const depth = settings.injectionDepth ?? defaultSettings.injectionDepth;
                logSeq(`🔍 DEBUG: settings.injectionDepth=${settings.injectionDepth}, defaultSettings.injectionDepth=${defaultSettings.injectionDepth}, final depth=${depth}`);
                const role = settings.injectionRole || defaultSettings.injectionRole;
                
                // AGGRESSIVE HIGH-PRIORITY injection - AI MUST see this FIRST!
                // User controls if injections persist via "Send BunnyMo blocks to AI context" setting
                const ephemeral = true; // Always ephemeral for dynamic character detection
                const injectionCommand = `/inject id=bunnymo-mandatory position=chat ephemeral=${ephemeral} scan=true depth=${depth} role=${role} ${injectionText}`;
                
                try {
                    logSeq(`🔥 EXECUTING: ${injectionCommand}`);
                    logSeq(`⚙️ Settings: depth=${depth}, role=${role}, ephemeral=${ephemeral} (${ephemeral ? 'one-time only' : 'persistent in context'})`);
                    
                    const result = await context.executeSlashCommandsWithOptions(injectionCommand, { 
                        showOutput: true, // Show output to verify it worked 
                        handleExecutionErrors: true 
                    });
                    
                    logSeq(`✅ Injection executed - should appear in chat completion context`);
                    logSeq(`📋 INJECTED DATA (depth=${depth}):`);
                    logSeq(characterData.substring(0, 200) + '...');
                    
                    // Verify the injection worked
                    if (!ephemeral) {
                        logSeq('💾 PERSISTENT injection - will remain in context for future messages');
                    } else {
                        logSeq('⚡ EPHEMERAL injection - one-time use only');
                    }
                    
                    // AUTO-DISPLAY: Show users exactly what was FORCE-FED to the AI (DOM + PERSISTENCE)
                    setTimeout(() => {
                        displayInjectedCharacterDataWithPersistence(characterData, activeCharacters);
                    }, 500); // Small delay to ensure message appears
                    
                } catch (error) {
                    logSeq(`❌ Mandatory injection failed: ${error.message}`);
                }
            } else {
                logSeq('❌ Context not available for mandatory injection');
            }
        }
        
        // NEW: Process activated lorebook entries to extract character data
        async function processActivatedLorebookEntries(entryList) {
            if (!entryList || entryList.length === 0) {
                logSeq('No lorebook entries activated');
                return;
            }
            
            
            logSeq(`🔍 DEBUG: Processing ${entryList.length} activated entries`);
            const characterRepoBooksList = extension_settings[extensionName]?.characterRepoBooks || [];
            logSeq(`🔍 DEBUG: Character repo books configured: ${JSON.stringify(characterRepoBooksList)}`);
            
            // Show what recent messages are being scanned
            if (chat && chat.length > 0) {
                const recentMessages = chat.slice(-5); // Show last 5 messages to catch feedback loop
                logSeq(`🔍 DEBUG: Recent messages being scanned by SillyTavern (last ${recentMessages.length} messages):`);
                recentMessages.forEach((msg, index) => {
                    const messageContent = msg.mes || 'no content';
                    const isSystem = msg.is_system;
                    const isBunnyMo = messageContent.includes('🥕') || messageContent.includes('BunnyMo') || msg.name === 'System';
                    
                    logSeq(`  Message ${index} [${msg.name}] ${isSystem ? '(SYSTEM)' : '(USER/AI)'} ${isBunnyMo ? '(BUNNYMO!)' : ''}:`);
                    logSeq(`    Full content: "${messageContent}"`);
                    
                    // Check if this message contains any scanned character names that might trigger lorebook
                    const scannedCharacterNames = Array.from(scannedCharacters.keys());
                    const foundNames = scannedCharacterNames.filter(name => messageContent.toLowerCase().includes(name.toLowerCase()));
                    if (foundNames.length > 0) {
                        logSeq(`    🚨 CONTAINS CHARACTER NAMES: ${foundNames.join(', ')} - This might trigger lorebook!`);
                    }
                });
            }
            
            // Log all activated entries for debugging
            entryList.forEach((entry, index) => {
                logSeq(`🔍 DEBUG: Entry ${index}: world="${entry.world}", comment="${entry.comment}", keys=${JSON.stringify(entry.key)}`);
                
                // Show exactly what this entry is looking for
                if (entry.key && entry.key.length > 0) {
                    logSeq(`    📝 This entry activates when these keys are found: ${entry.key.join(', ')}`);
                    
                    // Check messages that WorldInfo actually scanned for this entry (respecting scanDepth)
                    if (chat && chat.length > 0) {
                        // Get the actual scan depth for this entry (default to 3 if not set)
                        const entryScanDepth = entry.scanDepth || 3;
                        
                        // Only check the messages that WorldInfo would actually scan for this entry
                        // Messages are in reverse chronological order (newest first)
                        const messagesToScan = chat.slice(0, entryScanDepth);
                        messagesToScan.forEach((msg, msgIndex) => {
                            const content = msg.mes || '';
                            const triggeringKeys = entry.key.filter(key => 
                                content.toLowerCase().includes(key.toLowerCase())
                            );
                            if (triggeringKeys.length > 0) {
                                logSeq(`    🎯 Message ${msgIndex} [${msg.name}] likely triggered this entry with: ${triggeringKeys.join(', ')} (scanDepth: ${entryScanDepth})`);
                            }
                        });
                    }
                }
            });
            
            // Filter for character entries from selected character repos
            const characterEntries = entryList.filter(entry => {
                // Check if this entry is from a selected character repository
                const isFromCharacterRepo = characterRepoBooksList.includes(entry.world);
                
                logSeq(`🔍 DEBUG: Entry "${entry.comment}" from "${entry.world}" - isCharacterRepo: ${isFromCharacterRepo}`);
                
                if (isFromCharacterRepo) {
                    // SCANDEPTH ABSOLUTE OVERRIDE: Strict validation when enabled
                    const strictScanDepth = extension_settings[extensionName]?.strictScanDepth ?? false;
                    
                    if (strictScanDepth && entry.scanDepth !== null && entry.scanDepth !== undefined) {
                        // Strict mode: Only allow entries that have keywords in their exact scanDepth
                        let keywordFound = false;
                        
                        if (entry.key && entry.key.length > 0 && chat && chat.length > 0) {
                            const entryScanDepth = entry.scanDepth;
                            const messagesToScan = chat.slice(0, entryScanDepth);
                            
                            for (const key of entry.key) {
                                for (const msg of messagesToScan) {
                                    const content = (msg.mes || '').toLowerCase();
                                    if (content.includes(key.toLowerCase())) {
                                        keywordFound = true;
                                        logSeq(`🔒 STRICT MODE: "${key}" verified in "${msg.name}" within scanDepth ${entryScanDepth}`);
                                        break;
                                    }
                                }
                                if (keywordFound) break;
                            }
                        }
                        
                        if (keywordFound) {
                            logSeq(`✅ Character entry passed strict scanDepth validation: ${entry.comment || entry.key?.[0]}`);
                            return true;
                        } else {
                            logSeq(`❌ Character entry REJECTED by strict scanDepth validation: ${entry.comment || entry.key?.[0]} (scanDepth: ${entry.scanDepth})`);
                            return false;
                        }
                    } else {
                        // Normal mode: Trust WorldInfo's activation
                        logSeq(`✅ Character entry activated by WorldInfo: ${entry.comment || entry.key?.[0]} from ${entry.world}`);
                        
                        // Optional verification for debugging (but don't reject based on this)
                        if (entry.key && entry.key.length > 0 && chat && chat.length > 0) {
                            const entryScanDepth = entry.scanDepth || 3;
                            const messagesToScan = chat.slice(0, entryScanDepth);
                            
                            let keywordFound = false;
                            for (const key of entry.key) {
                                for (const msg of messagesToScan) {
                                    const content = (msg.mes || '').toLowerCase();
                                    if (content.includes(key.toLowerCase())) {
                                        keywordFound = true;
                                        logSeq(`🔍 Verified: "${key}" found in "${msg.name}" message within scanDepth ${entryScanDepth}`);
                                        break;
                                    }
                                }
                                if (keywordFound) break;
                            }
                            
                            if (!keywordFound) {
                                logSeq(`⚠️ Note: Could not verify keyword in current chat history (timing issue or other trigger mechanism)`);
                            }
                        }
                        
                        return true;
                    }
                }
                return false;
            });
            
            if (characterEntries.length === 0) {
                logSeq('No character repository entries were activated');
                return;
            }
            
            // Extract character data from activated entries
            const characterData = [];
            for (const entry of characterEntries) {
                const character = extractCharacterDataFromEntry(entry);
                if (character) {
                    characterData.push(character);
                }
            }
            
            if (characterData.length > 0) {
                logSeq(`🎴 Creating cards for ${characterData.length} activated characters`);
                
                // Create structured data for injection and display
                const structuredData = {
                    characters: characterData,
                    timestamp: Date.now()
                };
                
                // Send AI injection using the activated character data
                await injectActivatedCharacterData(structuredData);
                
                // Create and display cards immediately
                logSeq(`🎴 Creating immediate card display for activated characters`);
                await sendBunnyMoSystemMessage(structuredData);
            }
        }
        
        // Extract character data from a single lorebook entry
        function extractCharacterDataFromEntry(entry) {
            if (!entry.content) return null;
            
            const character = {
                name: entry.comment || entry.key?.[0] || 'Unknown',
                tags: {},
                source: entry.world,
                uid: entry.uid
            };
            
            // Parse BunnyMoTags from the entry content
            const bunnyTagsMatch = entry.content.match(/<BunnymoTags>(.*?)<\/BunnymoTags>/s);
            if (bunnyTagsMatch) {
                const tagsContent = bunnyTagsMatch[1];
                const tagMatches = tagsContent.match(/<([^:>]+):([^>]+)>/g);
                
                if (tagMatches) {
                    tagMatches.forEach(tagMatch => {
                        const match = tagMatch.match(/<([^:>]+):([^>]+)>/);
                        if (match) {
                            const category = match[1].toLowerCase().trim();
                            const value = match[2].trim();
                            
                            if (!character.tags[category]) {
                                character.tags[category] = [];
                            }
                            character.tags[category].push(value);
                        }
                    });
                }
            }
            
            logSeq(`✅ Extracted character: ${character.name} with ${Object.keys(character.tags).length} tag categories`);
            return character;
        }
        
        // Inject character data for activated characters only
        async function injectActivatedCharacterData(characterData) {
            if (!isEnabled()) {
                Debug.system('Extension disabled - skipping activated character data injection');
                return;
            }
            const settings = extension_settings[extensionName] || defaultSettings;
            
            if (!settings.sendToAI) {
                logSeq('AI injection disabled by user settings');
                return;
            }
            
            const bunnyMoBlock = generateBunnyMoBlock(characterData, 'json');
            const context = getContext();
            
            if (context && context.executeSlashCommandsWithOptions) {
                // Note: No manual cleanup needed - ephemeral injections are automatically cleaned up
                
                const depth = settings.injectionDepth ?? defaultSettings.injectionDepth;
                const role = settings.injectionRole || defaultSettings.injectionRole;
                const injectionText = settings.injectionPrompt.replace('{{CHARACTER_DATA}}', bunnyMoBlock);
                const ephemeral = true;
                
                const injectionCommand = `/inject id=bunnymo-activated position=chat ephemeral=${ephemeral} scan=true depth=${depth} role=${role} ${injectionText}`;
                
                try {
                    logSeq(`🎴 LOREBOOK-BASED INJECTION: ${characterData.characters.length} activated characters`);
                    logSeq(`⚙️ Settings: depth=${depth}, role=${role}, ephemeral=${ephemeral}`);
                    
                    const result = await context.executeSlashCommandsWithOptions(injectionCommand, { 
                        showOutput: settings.debugMode,
                        handleExecutionErrors: true 
                    });
                    
                    logSeq(`✅ Activated character data injected successfully`);
                } catch (error) {
                    logSeq(`❌ Failed to inject activated character data:`, error);
                }
            }
        }

        // Note: Manual cleanup functions removed to prevent interference with SillyTavern's 
        // automatic ephemeral injection system. Orphaned injections should not occur
        // when using ephemeral=true properly.

        // DISABLED: This function was replaced by lorebook-based system 
        // async function injectBunnyMoSystemMessage(messageIndex) {
        //     if (!chat || messageIndex >= chat.length) {
        //         logSeq(`❌ Invalid message index: ${messageIndex}`);
        //         return;
        //     }
        //     
        //     const message = chat[messageIndex];
        //     if (!message || !message.is_user) {
        //         logSeq(`❌ Message ${messageIndex} is not a user message`);
        //         return;
        //     }
        //     
        //     logSeq(`🔍 User message ${messageIndex} sent - checking for active characters to inject`);
        //     
        //     // Check if we have any scanned characters available
        //     if (scannedCharacters.size === 0) {
        //         logSeq('❌ No scanned characters available - need to scan lorebooks first or check character repo settings');
        //         return;
        //     }
        //     
        //     // Detect active characters from recent chat context
        //     let activeCharacters = detectActiveCharacters();
        //     
        //     if (activeCharacters.length === 0) {
        //         logSeq('No active characters detected in current context - no injection needed');
        //         return;
        //     }
        //     
        //     // Build character data for injection
        //     const allCharacterData = { characters: [] };
        //     
        //     activeCharacters.forEach(charName => {
        //         const charData = scannedCharacters.get(charName);
        //         if (charData) {
        //             const character = {
        //                 name: charName,
        //                 tags: {},
        //                 source: charData.source || 'BunnyMoTags'
        //             };
        //             
        //             // Convert Map structure to object for display
        //             for (const [tagType, tagSet] of charData.tags.entries()) {
        //                 character.tags[tagType] = Array.from(tagSet);
        //             }
        //             
        //             allCharacterData.characters.push(character);
        //         }
        //     });
        //     
        //     if (allCharacterData.characters.length === 0) {
        //         logSeq('No character data available for active characters');
        //         return;
        //     }
        //     
        //     // Ensure CSS is loaded for the cards
        //     if (!document.getElementById('bmt-card-styles')) {
        //         const link = document.createElement('link');
        //         link.id = 'bmt-card-styles';
        //         link.rel = 'stylesheet';
        //         link.type = 'text/css';
        //         link.href = '/scripts/extensions/third-party/BunnyMoTags/style.css';
        //         document.head.appendChild(link);
        //         logSeq('📎 Loaded BunnyMo card styles');
        //     }
        //     
        //     // Send fake user message with character cards (like SimTracker does)
        //     logSeq(`🎉 Sending BunnyMo system message with ${allCharacterData.characters.length} character card(s): ${activeCharacters.join(', ')}`);
        //     
        //     // Use the new template-based system message
        //     await sendBunnyMoSystemMessage(allCharacterData);
        //     
        //     
        //     logSeq('✅ BunnyMo system message sent successfully');
        // }
        
        // DISABLED: This function was replaced by lorebook-based system
        // function detectActiveCharacters() {
        //     const recentMessages = chat ? chat.slice(-5) : [];
        //     const activeCharacters = [];
        //     
        //     logSeq(`🔍 DEBUG: Checking ${recentMessages.length} recent messages for character detection`);
        //     logSeq(`🔍 DEBUG: Available scanned characters: ${Array.from(scannedCharacters.keys()).join(', ')}`);
        //     
        //     // Check recent message senders and content for character names (skip BunnyMo system messages)
        //     recentMessages.forEach((msg, index) => {
        //         // Skip BunnyMo system messages to avoid infinite loops
        //         if (msg.name === 'BunnyMoTags') {
        //             logSeq(`🔍 DEBUG: Skipping BunnyMo system message`);
        //             return;
        //         }
        //         
        //         logSeq(`🔍 DEBUG: Message ${index}: sender="${msg.name}", content="${msg.mes ? msg.mes.substring(0, 50) : 'no content'}..."`);
        //         
        //         // Check message sender
        //         if (msg.name && scannedCharacters.has(msg.name)) {
        //             if (!activeCharacters.includes(msg.name)) {
        //                 activeCharacters.push(msg.name);
        //                 logSeq(`🎯 Detected character sender: "${msg.name}"`);
        //             }
        //         }
        //         
        //         // Check message content for character mentions
        //         if (msg.mes) {
        //             const messageText = msg.mes.toLowerCase();
        //             logSeq(`🔍 DEBUG: Searching in text: "${messageText}"`);
        //             for (const charName of scannedCharacters.keys()) {
        //                 const nameLower = charName.toLowerCase();
        //                 
        //                 // Split character name into words and check if any word appears in message
        //                 const nameWords = nameLower.split(' ');
        //                 let found = false;
        //                 
        //                 for (const word of nameWords) {
        //                     if (word.length > 2 && messageText.includes(word)) { // Skip short words like "al", "ibn"
        //                         found = true;
        //                         logSeq(`🎯 Found name word "${word}" from "${charName}" in message`);
        //                         break;
        //                     }
        //                 }
        //                 
        //                 if (found && !activeCharacters.includes(charName)) {
        //                     activeCharacters.push(charName);
        //                     logSeq(`🎯 Detected character mention: "${charName}" in message: "${msg.mes}"`);
        //                 }
        //             }
        //         }
        //     });
        //     
        //     return activeCharacters;
        // }
        
        function setupAutoCharacterDetection() {
            
            // Listen for pre-generation events to inject character data
            if (eventSource) {
                
                // DISABLED: Old manual detection system - now using lorebook-based system only
                // eventSource.on(event_types.MESSAGE_SENT, (messageIndex) => {
                //     logSeq(`📤 MESSAGE_SENT event received for message ${messageIndex}`);
                //     
                //     // Avoid infinite loop by checking if this is a BunnyMo message
                //     if (chat[messageIndex] && chat[messageIndex].name === 'BunnyMoTags') {
                //         logSeq('Skipping BunnyMoTags message to avoid infinite loop');
                //         return;
                //     }
                //     
                //     setTimeout(() => {
                //         injectBunnyMoSystemMessage(messageIndex);
                //     }, 100);
                // });
                
                // 🔄 RESTORATION HOOKS - Auto-restore cards when needed
                eventSource.on(event_types.CHAT_CHANGED, () => {
                    logSeq('🔄 Chat changed - scheduling card restoration');
                    setTimeout(BMT_restoreAllCards, 500);
                });
                
                eventSource.on(event_types.MESSAGE_RENDERED, () => {
                    // Quick restoration check when messages are rendered
                    setTimeout(BMT_restoreAllCards, 100);
                });
                
                // ENABLED: Listen for lorebook activation instead of manual detection
                eventSource.on(event_types.WORLD_INFO_ACTIVATED, async (entryList) => {
                    const settings = extension_settings[extensionName] || defaultSettings;
                    if (!settings.enabled) return;
                    if (!settings.worldinfoEnabled) {
                        logSeq('🔇 WorldInfo Integration disabled by user settings, skipping');
                        return;
                    }
                    
                    logSeq(`🔥 WORLD_INFO_ACTIVATED - ${entryList.length} entries fired`);
                    
                    // RECURSION PREVENTION: Check if we can safely activate
                    if (!recursionPrevention.canActivate()) {
                        logSeq('🛑 WorldInfo activation skipped due to recursion prevention');
                        return;
                    }
                    
                    // Record this activation
                    recursionPrevention.recordActivation();
                    
                    try {
                        await processActivatedLorebookEntries(entryList);
                    } catch (error) {
                        logSeq('❌ Error in processActivatedLorebookEntries:', error);
                        // Reset on error to prevent stuck state
                        recursionPrevention.reset();
                    }
                });
                 
                // Reset recursion prevention on generation start
                eventSource.on(event_types.GENERATION_STARTED, () => {
                    logSeq('🚀 GENERATION_STARTED - resetting recursion prevention');
                    recursionPrevention.reset();
                });
                
                // DISABLED: Auto-injection on generation start - only inject when characters mentioned
                // eventSource.on(event_types.GENERATION_STARTED, () => {
                //     logSeq('⚡ GENERATION_STARTED - fallback injection');
                //     injectCharacterTags();
                // });
                
                // DISABLED: Old character detection - using system messages now
                // Set up listener for MESSAGE_RECEIVED to add simple indicators when Full Character Cards is disabled
                eventSource.on(event_types.MESSAGE_RECEIVED, (data) => {
                    const settings = extension_settings[extensionName] || defaultSettings;
                    
                    // Only add simple indicators if:
                    // 1. Extension is enabled
                    // 2. Full Character Cards is disabled (simple mode)
                    // 3. AI injection is enabled
                    // 4. We have character data from recent injection
                    if (settings.enabled && settings.useCardDisplay === false && settings.sendToAI && window.bmtLastInjectedData) {
                        Debug.events('MESSAGE_RECEIVED: Adding simple indicator for injected character data');
                        
                        // Add simple indicator after a short delay to ensure message is rendered
                        setTimeout(() => {
                            addSimpleCharacterIndicator(window.bmtLastInjectedData);
                            // Clear the data after using it
                            window.bmtLastInjectedData = null;
                        }, 500);
                    }
                });
                
                // DISABLED: Old card rendering events - using system messages now
                // eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
                //     setTimeout(() => {
                //         checkForActiveCharacters();
                //         if ($('#chat .bmt-thinking-block').length === 0) {
                //             restoreBunnyMoBlocksFromMessageData();
                //         }
                //     }, 1000);
                // });
                
                // DISABLED: Old restoration system - using system messages now
                // eventSource.on(event_types.CHAT_CHANGED, () => {
                //     logSeq('CHAT_CHANGED - restoring BunnyMo blocks from message data');
                //     setTimeout(() => restoreBunnyMoBlocksFromMessageData(), 1500);
                // });
                // 
                // eventSource.on(event_types.GROUP_UPDATED, () => {
                //     logSeq('GROUP_UPDATED - restoring BunnyMo blocks from message data');
                //     setTimeout(() => restoreBunnyMoBlocksFromMessageData(), 1500);
                // });
                
                
                // Load WorldInfo CSS and initialize WorldInfo system only if enabled
                if (extension_settings[extensionName]?.worldinfoEnabled !== false) {
                    if (!document.getElementById('bmwi-styles')) {
                        const worldInfoLink = document.createElement('link');
                        worldInfoLink.id = 'bmwi-styles';
                        worldInfoLink.rel = 'stylesheet';
                        worldInfoLink.type = 'text/css';
                        worldInfoLink.href = `${extensionFolderPath}/worldinfo.css`;
                        document.head.appendChild(worldInfoLink);
                        logSeq('✅ BunnyMoWorldInfo CSS loaded');
                    }
                    
                    // Initialize enhanced WorldInfo display
                    logSeq('Initializing BunnyMoWorldInfo system');
                    bunnyMoWorldInfoUI = initBunnyMoWorldInfo(scannedCharacters);
                } else {
                    logSeq('🔇 BunnyMoWorldInfo disabled by user settings');
                }
            }
        }
        
        function checkForActiveCharacters() {
            if (scannedCharacters.size === 0) {
                console.log('[BMT SYSTEM] No scanned characters to detect');
                return;
            }
            
            const recentMessages = chat ? chat.slice(-5) : [];
            const activeCharacters = [];
            
            // Check recent message senders and content for character names (skip BunnyMo system messages)
            recentMessages.forEach(msg => {
                // Skip BunnyMo system messages to avoid infinite loops
                if (msg.name === 'BunnyMoTags') {
                    return;
                }
                
                // Check message sender
                if (msg.name && scannedCharacters.has(msg.name)) {
                    if (!activeCharacters.includes(msg.name)) {
                        activeCharacters.push(msg.name);
                    }
                }
                
                // Check message content for character mentions
                if (msg.mes) {
                    const messageText = msg.mes.toLowerCase();
                    for (const charName of scannedCharacters.keys()) {
                        const nameLower = charName.toLowerCase();
                        
                        // Split character name into words and check if any word appears in message
                        const nameWords = nameLower.split(' ');
                        let found = false;
                        
                        for (const word of nameWords) {
                            if (word.length > 2 && messageText.includes(word)) { // Skip short words like "al", "ibn"
                                found = true;
                                break;
                            }
                        }
                        
                        if (found && !activeCharacters.includes(charName)) {
                            activeCharacters.push(charName);
                        }
                    }
                }
            });
            
            if (activeCharacters.length > 0) {
                showRealCharacterInsights(activeCharacters);
            }
        }
        
        function showRealCharacterInsights(characterNames) {
            logSeq(`Active characters detected: ${JSON.stringify(characterNames)}`);
            
            // Build BunnyMo tags content for message injection
            let bunnyMoContent = '';
            characterNames.forEach(charName => {
                const charData = scannedCharacters.get(charName);
                if (charData) {
                    bunnyMoContent += `${charName}:\n`;
                    for (const [tagType, tagValues] of charData.tags) {
                        const displayValues = Array.from(tagValues).join(', ');
                        bunnyMoContent += `- ${tagType}: ${displayValues}\n`;
                    }
                    bunnyMoContent += '\n';
                }
            });
            
            if (!bunnyMoContent.trim()) {
                logSeq('No character info to display');
                return;
            }
            
            // Get the last message and inject BunnyMo content into it
            if (!chat || chat.length === 0) return;
            const lastMessage = chat[chat.length - 1];
            if (!lastMessage) return;
            
            // Check if we already added BunnyMo content to this message
            if (lastMessage.extra && lastMessage.extra.bunnymo_injected) {
                logSeq('BunnyMo content already injected into this message');
                return;
            }
            
            // Inject BunnyMo content into the message
            const bunnyMoTags = `<BunnyMoTags>\n${bunnyMoContent}</BunnyMoTags>`;
            
            // Add to the beginning of the message content
            lastMessage.mes = bunnyMoTags + '\n\n' + lastMessage.mes;
            
            // Mark as injected to avoid duplicates
            lastMessage.extra = lastMessage.extra || {};
            lastMessage.extra.bunnymo_injected = true;
            
            logSeq('BunnyMo content injected into message, triggering reprocessing');
            
            // DOM + persistence system handles display automatically
            logSeq('Message updated - DOM system will handle display');
        }

        
        
        async function showTestCharacterInsights() {
            Debug.system('Test Display function called');
            
            // Check master enable first
            const settings = extension_settings[extensionName] || defaultSettings;
            if (!settings.enabled) {
                Debug.error('Master toggle disabled - blocking test display');
                alert('BunnyMoTags is disabled. Please enable the Master Enable toggle first.');
                return;
            }
            
            logSeq('🧪 TEST: Creating fake AI message to test display system');
            
            // Check if there's at least one AI message to attach to
            if (!chat || chat.length === 0) {
                alert('No messages in chat. Send at least one AI message first, then test.');
                return;
            }
            
            // Find the last AI message (never user message)
            let lastAIMessage = null;
            for (let i = chat.length - 1; i >= 0; i--) {
                if (!chat[i].is_user) {
                    lastAIMessage = chat[i];
                    break;
                }
            }
            
            if (!lastAIMessage) {
                alert('No AI messages found to test with. Chat with the AI first, then test.');
                return;
            }
            
            // Use actual scanned character data from lorebooks instead of hardcoded test data
            if (scannedCharacters.size > 0) {
                const actualCharacterData = {
                    characters: Array.from(scannedCharacters.entries()).map(([name, data]) => ({
                        name: name,
                        tags: Object.fromEntries(data.tags),
                        source: data.source || 'Lorebooks'
                    }))
                };
                
                Debug.system('Calling sendBunnyMoSystemMessage with actual scanned character data', {
                    characterCount: actualCharacterData.characters.length,
                    characters: actualCharacterData.characters.map(c => c.name)
                });
                
                await sendBunnyMoSystemMessage(actualCharacterData);
                
                Debug.system('Test display completed - check for cards in UI');
                logSeq(`🎴 TEST complete - ${actualCharacterData.characters.length} character cards sent via system message!`);
            } else {
                logSeq('⚠️ No scanned characters available for test display. Please scan lorebooks first.');
                toastr.warning('No characters found. Please scan some lorebooks first!');
            }
        }
        
        
    } catch (error) {
        logSeq(`Failed to initialize: ${error.message}`);
    }
});

// ===== NEW CARD-BASED SYSTEM =====

// DISABLED: This function was replaced by lorebook-based system
// async function injectCharacterTagsCardBased() {
//     // This function is no longer used - replaced by processActivatedLorebookEntries
// }

// Create structured character data for card display and AI injection
function createCardBasedCharacterData(activeCharactersFilter = null) {
    if (scannedCharacters.size === 0) {
        logSeq('❌ No scanned characters available - lorebook scanning failed or no character repos selected');
        return null;
    }
    
    const settings = extension_settings[extensionName] || defaultSettings;
    const maxCharacters = settings.maxCharactersShown || 6;
    
    const characters = [];
    let count = 0;
    
    // Use active characters filter if provided, otherwise use all scanned characters
    const charactersToProcess = activeCharactersFilter ? 
        activeCharactersFilter.filter(name => scannedCharacters.has(name)) : 
        Array.from(scannedCharacters.keys());
    
    for (const characterName of charactersToProcess) {
        if (count >= maxCharacters) break;
        const characterInfo = scannedCharacters.get(characterName);
        
        const character = {
            name: characterName,
            tags: {},
            source: characterInfo.source
        };
        
        // Convert Map structure to object for JSON serialization
        for (const [tagType, tagSet] of characterInfo.tags.entries()) {
            character.tags[tagType] = Array.from(tagSet);
        }
        
        // Only include characters with actual tag data
        if (Object.keys(character.tags).length > 0) {
            characters.push(character);
            count++;
        }
    }
    
    return characters.length > 0 ? { characters } : null;
}

// Schedule card rendering for the next AI message
let pendingCardData = null;

function scheduleCardRendering(characterData) {
    pendingCardData = characterData;
    logSeq(`📅 Scheduled card rendering for ${characterData.characters.length} characters`);
}

// Handle pending card data and delegate to message processor
async function handleCardRendering(messageId) {
    const settings = extension_settings[extensionName] || defaultSettings;
    
    if (!settings.useCardDisplay) {
        return;
    }
    
    // Get the message from chat array
    const context = getContext();
    const message = context.chat[messageId];
    if (!message) {
        console.log(`[BMT CARDS] Could not find message with ID ${messageId}`);
        return;
    }
    
    // Check if we have pending card data to render
    if (pendingCardData) {
        logSeq(`🎴 Sending pending cards for message ${messageId} via system message`);
        await sendBunnyMoSystemMessage(pendingCardData);
        pendingCardData = null;
        return;
    }
    
    // Delegate to the message processor for parsing existing messages
    processMessageForCards(messageId);
}

// ============================================================================
// NEW TEMPLATE-BASED RENDERING SYSTEM
// ============================================================================
// The old complex DOM manipulation and edit handling has been replaced with
// a SimTracker-inspired template-based system that handles edits automatically
// by re-parsing message content. This provides:
// - Automatic edit handling without complex recovery logic
// - Handlebars template-based rendering for consistency
// - Proper message formatting integration
// - Robust persistence through message content parsing
// ============================================================================

// Add message interceptor for token optimization
let messageInterceptorActive = false;

function activateMessageInterceptor() {
    if (messageInterceptorActive) return;
    
    // Intercept messages before they're sent to AI for token optimization
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        const originalExecute = SillyTavern.getContext().executeSlashCommandsWithOptions;
        if (originalExecute) {
            SillyTavern.getContext().executeSlashCommandsWithOptions = function(command, options) {
                // Process command for token optimization if it contains BunnyMo data
                const processedCommand = processMessageForAI(command, false);
                return originalExecute.call(this, processedCommand, options);
            };
            messageInterceptorActive = true;
            logSeq('📡 Message interceptor activated for token optimization');
        }
    }
}

// Enhanced event listeners for card system (like SimTracker)
function setupCardEventListeners() {
    if (eventSource) {
        // Handle message rendering - no action needed for HTML cards
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (mesId) => {
            logSeq(`🎴 Character message rendered - HTML cards work automatically`);
        });
        
        // Handle message edits - need to check if external cards need restoration
        eventSource.on(event_types.MESSAGE_EDITED, (mesId) => {
            logSeq(`🔄 Message ${mesId} was edited - checking external cards`);
            setTimeout(() => {
                // Check if this was a BunnyMo message and restore cards if needed
                const attachment = attachedCards.get(mesId.toString());
                if (attachment) {
                    // Try to parse updated data from the edited message
                    const messageElement = document.querySelector(`div[mesid="${mesId}"]`);
                    if (messageElement) {
                        const dataAnchor = messageElement.querySelector('.bunnymo-data-anchor');
                        if (dataAnchor) {
                            try {
                                const updatedData = parseBunnyMoData(dataAnchor.textContent);
                                if (updatedData) {
                                    // Update the external cards with new data
                                    removeExternalCardsForMessage(mesId);
                                    attachExternalCardsToMessage(mesId, updatedData);
                                    logSeq(`✅ Updated external cards after edit`);
                                }
                            } catch (error) {
                                logSeq(`⚠️ Could not parse updated data, keeping original cards`);
                            }
                        }
                    }
                }
            }, 300);
        });
        
        // These events might disrupt external DOM - restore if needed
        eventSource.on(event_types.MESSAGE_UPDATED, () => {
            logSeq(`🔄 Message updated - checking external card integrity`);
            setTimeout(() => restoreAllExternalCards(), 100);
        });
        
        eventSource.on(event_types.CHAT_CHANGED, () => {
            logSeq(`🔄 Chat changed - clearing external card registry`);
            attachedCards.clear();
        });
        
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
            logSeq(`🔄 More messages loaded - restoring external cards`);
            setTimeout(() => restoreAllExternalCards(), 200);
        });
        
        // Message swipes might affect DOM structure
        eventSource.on(event_types.MESSAGE_SWIPE, (mesId) => {
            logSeq(`🔄 Message swipe detected - checking card integrity`);
            setTimeout(() => restoreAllExternalCards(), 100);
        });
        
        // Handle generation events
        eventSource.on(event_types.GENERATION_STARTED, () => {
            logSeq(`🎬 Generation started`);
        });
        
        eventSource.on(event_types.GENERATION_ENDED, () => {
            logSeq(`🎬 Generation ended. Checking for pending cards.`);
            // Increased delay to ensure ST's ephemeral cleanup completes first
            // ST's ephemeral injection cleanup runs immediately on GENERATION_ENDED
            setTimeout(() => refreshAllBunnyMoCards(), 800);
        });
        
        // Activate token optimization interceptor
        activateMessageInterceptor();
        
        logSeq('🎴 Complete card-based event listeners activated (like SimTracker)');
    }
}

// Initialize card system
function initializeCardSystem() {
    const settings = extension_settings[extensionName] || defaultSettings;
    
    // FORCE ENABLE card system for testing
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    
    // Settings interface removed for simplicity
    
    // Set card display as default
    if (extension_settings[extensionName].useCardDisplay === undefined) {
        extension_settings[extensionName].useCardDisplay = true;
        logSeq('🔧 Auto-enabled card display system');
    }
    
    if (settings.useCardDisplay !== false) {
        setupCardEventListeners();
        logSeq('🚀 Card-based BunnyMoTags system ACTIVATED');
    } else {
        logSeq('📋 Card display disabled - using legacy system');
    }
}

// Load and setup new settings UI
function setupNewSettingsUI() {
    const settings = extension_settings[extensionName] || defaultSettings;
    
    // Load card display settings
    if ($('#bmt-use-card-display').length > 0) {
        $('#bmt-use-card-display').prop('checked', settings.useCardDisplay !== false);
    }
    if ($('#bmt-card-position').length > 0) {
        $('#bmt-card-position').val(settings.cardPosition || 'BOTTOM');
    }
    
    // Load token optimization settings
    if ($('#bmt-ai-use-compact-format').length > 0) {
        $('#bmt-ai-use-compact-format').prop('checked', settings.aiUseCompactFormat !== false);
    }
    if ($('#bmt-optimize-user-messages').length > 0) {
        $('#bmt-optimize-user-messages').prop('checked', settings.optimizeUserMessages !== false);
    }
    if ($('#bmt-ai-max-characters').length > 0) {
        const maxChars = settings.aiMaxCharacters || 4;
        $('#bmt-ai-max-characters').val(maxChars);
        $('#bmt-ai-max-characters-value').text(maxChars);
    }
    if ($('#bmt-ai-max-tags-per-category').length > 0) {
        const maxTags = settings.aiMaxTagsPerCategory || 2;
        $('#bmt-ai-max-tags-per-category').val(maxTags);
        $('#bmt-ai-max-tags-per-category-value').text(maxTags);
    }
    if ($('#bmt-ai-priority-tags').length > 0) {
        const priorityTags = settings.aiPriorityTags || ['species', 'personality', 'physical'];
        $('#bmt-ai-priority-tags').val(priorityTags.join(', '));
    }
}

// Setup event listeners for new settings
function setupNewSettingsEventListeners() {
    // Slider value updates
    $(document).on('input', '#bmt-ai-max-characters', function() {
        $('#bmt-ai-max-characters-value').text($(this).val());
        updateTokenPreview();
    });
    
    $(document).on('input', '#bmt-ai-max-tags-per-category', function() {
        $('#bmt-ai-max-tags-per-category-value').text($(this).val());
        updateTokenPreview();
    });
    
    // Settings change handlers
    $(document).on('change', '#bmt-use-card-display, #bmt-card-theme, #bmt-ai-use-compact-format, #bmt-optimize-user-messages, #bmt-ai-max-characters, #bmt-ai-max-tags-per-category', function() {
        saveSettings();
        updateTokenPreview();
        
        // Reinitialize card system if display mode changed
        if ($(this).attr('id') === 'bmt-use-card-display') {
            setTimeout(() => initializeCardSystem(), 100);
        }
    });
    
    $(document).on('input blur', '#bmt-ai-priority-tags', function() {
        saveSettings();
        updateTokenPreview();
    });
    
    // Template UI event handlers are now set up in setupTemplateEventListeners()
    
    // Template toggle enable/disable
    $(document).on('change', '[data-template-toggle]', function() {
        const templateKey = $(this).data('template-toggle');
        const isEnabled = $(this).is(':checked');
        
        if (templateKey && templateManager) {
            const template = templateManager.getTemplate(templateKey);
            if (template) {
                const updatedTemplate = {
                    ...template,
                    enabled: isEnabled
                };
                templateManager.setTemplate(templateKey, updatedTemplate);
            }
        }
    });
    
    // Template role selection
    $(document).on('change', '[data-template-role]', function() {
        const templateKey = $(this).data('template-role');
        const newRole = $(this).val();
        
        if (templateKey && templateManager) {
            const template = templateManager.getTemplate(templateKey);
            if (template) {
                const updatedTemplate = {
                    ...template,
                    role: newRole
                };
                templateManager.setTemplate(templateKey, updatedTemplate);
            }
        }
    });
    
    // Template actions
    $(document).on('click', '#bmt-save-template', function() {
        saveCurrentTemplate();
    });
    
    $(document).on('click', '#bmt-reset-template', function() {
        resetCurrentTemplate();
    });
    
    $(document).on('click', '#bmt-validate-template', function() {
        validateCurrentTemplate();
    });
    
    $(document).on('click', '#bmt-preview-template', function() {
        previewCurrentTemplate();
    });
    
    $(document).on('click', '#bmt-export-templates', function() {
        exportTemplates();
    });
    
    $(document).on('click', '#bmt-import-templates', function() {
        $('#bmt-import-modal').fadeIn(200);
    });
    
    // Modal handlers
    $(document).on('click', '#bmt-close-preview-modal, #bmt-close-preview', function() {
        $('#bmt-template-preview-modal').fadeOut(200);
    });
    
    $(document).on('click', '#bmt-close-import-modal, #bmt-cancel-import', function() {
        $('#bmt-import-modal').fadeOut(200);
        $('#bmt-import-data').val('');
    });
    
    $(document).on('click', '#bmt-confirm-import', function() {
        importTemplates();
    });
    
    // Variable click-to-insert
    $(document).on('click', '.bmt-variable-item', function() {
        const variable = $(this).data('variable');
        if (variable) {
            const editor = $('#bmt-template-editor')[0];
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            const text = editor.value;
            const newText = text.substring(0, start) + '{{' + variable + '}}' + text.substring(end);
            editor.value = newText;
            editor.focus();
            editor.setSelectionRange(start + variable.length + 4, start + variable.length + 4);
        }
    });
    
    // Template UI initialization moved to main extension initialization
}

// ===== TEMPLATE MANAGEMENT UI FUNCTIONS =====

async function initializeTemplateUI() {
    console.log('🎨 Initializing modern template UI...');
    
    if (!templateManager) {
        console.error('❌ Template manager not available');
        return;
    }
    
    // Populate UI components
    await populateTemplateDropdown();
    populatePresetDropdown();
    
    // Set up event listeners
    setupTemplateEventListeners();
    
    // Start with empty state - no template selected
    $('#bmt-empty-state').show();
    $('#bmt-edit-only-state').hide();
    
    console.log('✨ Modern template UI initialized successfully');
}

// Function to check if a template is actively being used
function isTemplateActivelyUsed(templateKey) {
    if (!templateManager) return false;
    
    const settings = extension_settings[extensionName] || {};
    const template = templateManager.getTemplate(templateKey);
    if (!template) return false;
    
    // Check if extension is enabled
    if (!settings.enabled) return false;
    
    // Check by category and current usage
    switch (template.category) {
        case 'injection':
            // Active if AI integration is enabled and template is enabled
            return settings.sendToAI && template.enabled !== false;
            
        case 'generation':
            // Active if extension is enabled and template is enabled
            return settings.enabled && template.enabled !== false;
            
        case 'format':
            // Active if extension is enabled and template is enabled
            return settings.enabled && template.enabled !== false;
            
        default:
            return false;
    }
}

async function populateTemplateDropdown() {
    console.log('🎯 Populating modern template list...');
    
    if (!templateManager) {
        console.error('❌ templateManager not available, attempting to initialize...');
        
        // Try to initialize template manager if it doesn't exist
        try {
            const { initializeTemplateManager } = await import('./templateManager.js');
            templateManager = initializeTemplateManager(extensionName);
            console.log('✅ Template manager emergency initialization completed');
        } catch (error) {
            console.error('❌ Failed to initialize template manager:', error);
            
            const $list = $('#bmt-template-list');
            $list.empty();
            $list.append(`
                <div class="bmt-no-templates">
                    <i class="fa-solid fa-exclamation-triangle"></i>
                    <p>Template Manager Error</p>
                    <p style="font-size: 0.8em; opacity: 0.7;">Failed to initialize template system.</p>
                    <button onclick="location.reload()" style="margin-top: 10px; padding: 5px 10px; background: #ff4444; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Reload Page
                    </button>
                </div>
            `);
            return;
        }
    }
    
    const allTemplates = templateManager.getAllTemplates();
    console.log('📋 All templates found:', Object.keys(allTemplates).length);
    console.log('🔍 Template keys:', Object.keys(allTemplates));
    console.log('🧪 Template manager instance:', templateManager);
    
    const $list = $('#bmt-template-list');
    $list.empty();
    
    if (Object.keys(allTemplates).length === 0) {
        console.warn('⚠️ No templates found! Attempting to reload defaults...');
        
        // Try to reload defaults if no templates found
        if (templateManager.loadDefaultTemplates) {
            templateManager.loadDefaultTemplates();
            templateManager.ensureTemplatesWithFallbacks();
            const retryTemplates = templateManager.getAllTemplates();
            console.log('🔄 After reload attempt:', Object.keys(retryTemplates).length);
            
            if (Object.keys(retryTemplates).length > 0) {
                // Recursive call with newly loaded templates
                return populateTemplateDropdown();
            }
        }
        
        $list.append(`
            <div class="bmt-no-templates">
                <i class="fa-solid fa-exclamation-triangle"></i>
                <p>No templates available</p>
                <p style="font-size: 0.8em; opacity: 0.7;">Template manager may not be initialized properly.</p>
                <button onclick="location.reload()" style="margin-top: 10px; padding: 5px 10px; background: var(--SmartThemeBodyColor); color: var(--SmartThemeEmptyColor); border: none; border-radius: 4px; cursor: pointer;">
                    Reload Page
                </button>
            </div>
        `);
        console.log('❌ Template list populated with 0 templates after retry');
        return;
    }
    
    // Group templates by category for better organization
    const categories = ['generation', 'injection', 'format'];
    const categorizedTemplates = {};
    
    // Initialize categories
    categories.forEach(cat => categorizedTemplates[cat] = []);
    
    // Sort templates into categories
    Object.entries(allTemplates).forEach(([key, template]) => {
        const category = template.category || 'generation';
        if (!categorizedTemplates[category]) {
            categorizedTemplates[category] = [];
        }
        categorizedTemplates[category].push([key, template]);
    });
    
    // Add templates by category
    let totalAdded = 0;
    categories.forEach(category => {
        if (categorizedTemplates[category] && categorizedTemplates[category].length > 0) {
            // Sort templates in category by name
            categorizedTemplates[category].sort(([,a], [,b]) => {
                if (a.isDefault && !b.isDefault) return -1;
                if (!a.isDefault && b.isDefault) return 1;
                return a.label.localeCompare(b.label);
            });
            
            // Add templates
            categorizedTemplates[category].forEach(([key, template]) => {
                const isActive = isTemplateActivelyUsed(key);
                const item = createTemplateListItem(key, template, isActive);
                $list.append(item);
                totalAdded++;
            });
        }
    });
    
    console.log('✅ Template list populated with', totalAdded, 'templates');
}

function createTemplateListItem(key, template, isActive) {
    const statusClass = isActive ? 'live' : 'inactive';
    const nameClass = template.isDefault ? 'default' : '';
    
    const $item = $(`
        <div class="bmt-template-item" data-template-key="${key}">
            <div class="bmt-template-item-header">
                <div class="bmt-template-name ${nameClass}">${template.label}</div>
                <div class="bmt-template-status ${statusClass}">${isActive ? 'LIVE' : 'OFF'}</div>
            </div>
            <div class="bmt-template-meta">
                <span class="bmt-template-category">${template.category || 'general'}</span>
                <span class="bmt-template-role">Role: ${template.role || 'system'}</span>
            </div>
        </div>
    `);
    
    // Add click handler for template selection
    $item.on('click', function() {
        $('.bmt-template-item').removeClass('active');
        $(this).addClass('active');
        
        // Update editor preview
        selectTemplate(key);
    });
    
    return $item;
}

// Advanced Editor System
let currentEditingTemplate = null;
let currentMacroDefinitions = {};

// Detect macros in template content
function detectMacros(content) {
    if (!content) return [];
    
    const macroRegex = /\{\{([^}]+)\}\}/g;
    const macros = new Set();
    let match;
    
    while ((match = macroRegex.exec(content)) !== null) {
        const macroName = match[1].trim();
        if (macroName) {
            macros.add(macroName);
        }
    }
    
    return Array.from(macros);
}

// Generate macro input fields
function generateMacroFields(macros, currentDefinitions = {}) {
    if (!macros || macros.length === 0) {
        return '<div class="bmt-no-macros"><i class="fa-solid fa-info-circle"></i><p>No macros detected in template content.</p><p>Use <code>{{MACRO_NAME}}</code> format to create macros.</p></div>';
    }
    
    return macros.map(macro => {
        const currentValue = currentDefinitions[macro] || '';
        const usageCount = (currentEditingTemplate?.content?.match(new RegExp(`\\{\\{${macro}\\}\\}`, 'g')) || []).length;
        
        return `
            <div class="bmt-macro-item" data-macro="${macro}">
                <div class="bmt-macro-header">
                    <div class="bmt-macro-name">{{${macro}}}</div>
                    <div class="bmt-macro-usage">${usageCount} usage${usageCount !== 1 ? 's' : ''}</div>
                </div>
                <div class="bmt-macro-content">
                    <textarea 
                        class="bmt-macro-input" 
                        data-macro-name="${macro}"
                        placeholder="Define the value for {{${macro}}}..."
                        rows="3"
                    >${currentValue}</textarea>
                </div>
            </div>
        `;
    }).join('');
}

// Open advanced template editor
async function openAdvancedEditor(key) {
    console.log('🎨 Opening advanced editor for:', key);
    
    if (!key || !templateManager) return;
    
    const template = templateManager.getTemplate(key);
    if (!template) return;
    
    // Store current editing context
    currentEditingTemplate = template;
    currentMacroDefinitions = getMacroDefinitions(key) || {};
    
    // Show the modal
    $('#bmt-advanced-editor-modal').show();
    
    // Populate header information
    $('#bmt-editor-template-name').text(template.label);
    $('#bmt-editor-category').text(template.category || 'generation');
    $('#bmt-editor-role').text(template.role || 'system');
    
    // Populate template content
    $('#bmt-advanced-content').val(template.content || '');
    updateCharCount();
    
    // Detect and populate macros
    refreshMacroDetection();
}

// Refresh macro detection and UI
function refreshMacroDetection() {
    if (!currentEditingTemplate) return;
    
    const content = $('#bmt-advanced-content').val();
    const macros = detectMacros(content);
    
    // Update macro count in header
    $('#bmt-editor-macro-count').text(`${macros.length} macro${macros.length !== 1 ? 's' : ''}`);
    $('#bmt-macro-count').text(`${macros.length} macro${macros.length !== 1 ? 's' : ''}`);
    
    // Generate macro fields
    const macroFieldsHTML = generateMacroFields(macros, currentMacroDefinitions);
    $('#bmt-macros-container').html(macroFieldsHTML);
    
    // Add event listeners to macro inputs
    $('.bmt-macro-input').on('input', function() {
        const macroName = $(this).data('macro-name');
        const value = $(this).val();
        currentMacroDefinitions[macroName] = value;
    });
}

// Update character count
function updateCharCount() {
    const content = $('#bmt-advanced-content').val();
    const charCount = content ? content.length : 0;
    $('#bmt-content-char-count').text(`${charCount.toLocaleString()} characters`);
}

// Get saved macro definitions for a template
function getMacroDefinitions(templateKey) {
    if (!extension_settings[extensionName]) return {};
    if (!extension_settings[extensionName].macroDefinitions) return {};
    return extension_settings[extensionName].macroDefinitions[templateKey] || {};
}

// Save macro definitions for a template
function saveMacroDefinitions(templateKey, definitions) {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    if (!extension_settings[extensionName].macroDefinitions) {
        extension_settings[extensionName].macroDefinitions = {};
    }
    
    extension_settings[extensionName].macroDefinitions[templateKey] = definitions;
    saveSettings();
}

// Save template with macro definitions
async function saveAdvancedTemplate() {
    if (!currentEditingTemplate) return;
    
    const newContent = $('#bmt-advanced-content').val();
    const templateKey = Object.keys(templateManager.getAllTemplates()).find(key => 
        templateManager.getTemplate(key) === currentEditingTemplate
    );
    
    if (!templateKey) return;
    
    // Update template content
    const updatedTemplate = {
        ...currentEditingTemplate,
        content: newContent
    };
    
    templateManager.setTemplate(templateKey, updatedTemplate);
    
    // Save macro definitions
    saveMacroDefinitions(templateKey, currentMacroDefinitions);
    
    console.log('💾 Advanced template saved:', templateKey);
    toastr.success('Template and macros saved successfully');
    
    // Close modal and refresh UI
    closeAdvancedEditor();
    await populateTemplateDropdown();
    selectTemplate(templateKey);
}

// Close advanced editor
function closeAdvancedEditor() {
    $('#bmt-advanced-editor-modal').hide();
    currentEditingTemplate = null;
    currentMacroDefinitions = {};
}

// Reset template to default
async function resetAdvancedTemplate() {
    if (!currentEditingTemplate) return;
    
    const templateKey = Object.keys(templateManager.getAllTemplates()).find(key => 
        templateManager.getTemplate(key) === currentEditingTemplate
    );
    
    if (!templateKey) return;
    
    if (confirm('Reset this template to its default content? This will lose any custom changes and macro definitions.')) {
        if (templateManager.resetTemplate(templateKey)) {
            // Clear macro definitions
            if (extension_settings[extensionName]?.macroDefinitions) {
                delete extension_settings[extensionName].macroDefinitions[templateKey];
                saveSettings();
            }
            
            // Refresh editor with default content
            const resetTemplate = templateManager.getTemplate(templateKey);
            currentEditingTemplate = resetTemplate;
            currentMacroDefinitions = {};
            
            $('#bmt-advanced-content').val(resetTemplate.content || '');
            updateCharCount();
            refreshMacroDetection();
            
            console.log('🔄 Template reset to default:', templateKey);
            toastr.success('Template reset to default');
        }
    }
}

function generateVariablesHTML(variables) {
    if (!variables || variables.length === 0) {
        return '<p><em>No variables available for this template.</em></p>';
    }
    
    const hints = {
        'USER_REQUEST': 'The user\'s character generation request text',
        'SELECTED_TRAITS': 'Currently selected character traits from BunnyMo interface',
        'BUNNYMO_DESCRIPTION': 'System information about BunnyMo functionality',
        'CHARACTER_CONTEXT': 'Existing character card information if available',
        'WORLD_INFO': 'Active World Information entries for context',
        'CHAT_CONTEXT': 'Recent chat messages for character understanding',
        'LOREBOOK_CONTENT': 'Relevant lorebook entries from selected books',
        'AVAILABLE_TAGS': 'Available BunnyMo tags from your tag libraries',
        'CHARACTER_DATA': 'Dynamic character information for AI context',
        'SYSTEM_DESCRIPTION': 'BunnyMo system description text',
        'CHARACTER_CARD': 'Character card details',
        'MESSAGES': 'Chat message history',
        'traits': 'Template trait data for iteration'
    };
    
    return variables.map(variable => {
        const hint = hints[variable] || 'Template variable';
        return `
            <div style="margin: 4px 0; padding: 6px 8px; background: rgba(255, 165, 0, 0.1); border-radius: 4px; cursor: pointer;" 
                 onclick="insertVariable('${variable}')" title="Click to insert {{${variable}}}">
                <code style="color: var(--SmartThemeBodyColor); font-weight: 500;">{{${variable}}}</code>
                <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">${hint}</div>
            </div>
        `;
    }).join('');
}

// Function to insert variable into textarea
function insertVariable(variable) {
    const textarea = document.getElementById('bmt-popup-content');
    if (textarea) {
        const cursorPos = textarea.selectionStart;
        const textValue = textarea.value;
        const textBefore = textValue.substring(0, cursorPos);
        const textAfter = textValue.substring(cursorPos);
        const variableText = `{{${variable}}}`;
        
        textarea.value = textBefore + variableText + textAfter;
        textarea.focus();
        textarea.setSelectionRange(cursorPos + variableText.length, cursorPos + variableText.length);
    }
}

function selectTemplate(key) {
    console.log('📝 Selecting template:', key);
    
    if (!key || !templateManager) {
        // Show empty state
        $('#bmt-empty-state').show();
        $('#bmt-template-preview').hide();
        return;
    }
    
    const template = templateManager.getTemplate(key);
    if (!template) {
        // Show empty state
        $('#bmt-empty-state').show();
        $('#bmt-template-preview').hide();
        return;
    }
    
    // Hide empty state and show template preview
    $('#bmt-empty-state').hide();
    $('#bmt-template-preview').show();
    
    // Update template information
    $('#bmt-template-title').text(template.label);
    $('#bmt-template-category').text(template.category || 'generation');
    $('#bmt-template-role').text(template.role || 'system');
    
    // Detect macros and update count
    const macros = detectMacros(template.content);
    $('#bmt-macro-count').text(`${macros.length} macro${macros.length !== 1 ? 's' : ''}`);
    
    // Update content preview (truncated)
    const content = template.content || 'No content available';
    const maxPreviewLength = 300;
    const preview = content.length > maxPreviewLength 
        ? content.substring(0, maxPreviewLength) + '...'
        : content;
    $('#bmt-content-snippet').text(preview);
    
    // Store current selection for operations
    window.bmtCurrentTemplate = key;
}

function updateVariablesDisplay(template) {
    const $section = $('#bmt-variables-section');
    const $grid = $('#bmt-variables-grid');
    const $count = $('#bmt-variables-count');
    
    if (!template.variables || template.variables.length === 0) {
        $section.hide();
        return;
    }
    
    $section.show();
    $grid.empty();
    $count.text(`${template.variables.length} variables`);
    
    template.variables.forEach(variable => {
        const hint = getVariableHint(variable);
        const $item = $(`
            <div class="bmt-variable-item" data-variable="${variable}">
                <div class="bmt-variable-name">${variable}</div>
                <div class="bmt-variable-hint">${hint}</div>
            </div>
        `);
        
        // Add click handler to insert variable into template
        $item.on('click', function() {
            const textarea = document.getElementById('bmt-template-content');
            if (textarea) {
                const cursorPos = textarea.selectionStart;
                const textValue = textarea.value;
                const textBefore = textValue.substring(0, cursorPos);
                const textAfter = textValue.substring(cursorPos);
                const variableText = `{{${variable}}}`;
                
                textarea.value = textBefore + variableText + textAfter;
                textarea.focus();
                textarea.setSelectionRange(cursorPos + variableText.length, cursorPos + variableText.length);
                
                // Trigger input event to save changes
                $(textarea).trigger('input');
            }
        });
        
        $grid.append($item);
    });
}

function getVariableHint(variable) {
    const hints = {
        'USER_REQUEST': 'The user\'s character generation request text',
        'SELECTED_TRAITS': 'Currently selected character traits from BunnyMo interface',
        'BUNNYMO_DESCRIPTION': 'System information about BunnyMo functionality',
        'CHARACTER_CONTEXT': 'Existing character card information if available',
        'WORLD_INFO': 'Active World Information entries for context',
        'CHAT_CONTEXT': 'Recent chat messages for character understanding',
        'LOREBOOK_CONTENT': 'Relevant lorebook entries from selected books',
        'AVAILABLE_TAGS': 'Available BunnyMo tags from your tag libraries',
        'CHARACTER_DATA': 'Dynamic character information for AI context',
        'SYSTEM_DESCRIPTION': 'BunnyMo system description text',
        'CHARACTER_CARD': 'Character card details',
        'MESSAGES': 'Chat message history',
        'traits': 'Template trait data for iteration'
    };
    
    return hints[variable] || 'Template variable';
}

function populatePresetDropdown() {
    console.log('📦 Populating preset dropdown...');
    
    if (!templateManager) {
        console.error('❌ templateManager not available');
        return;
    }
    
    const presets = templateManager.getPresets();
    const selector = $('#bmt-preset-selector');
    const currentValue = selector.val();
    
    selector.empty();
    
    for (const [key, preset] of Object.entries(presets)) {
        const displayName = preset.name || key;
        const createdDate = preset.created ? ` (${new Date(preset.created).toLocaleDateString()})` : '';
        const optionText = `${displayName}${createdDate}`;
        
        selector.append(`<option value="${key}">${optionText}</option>`);
    }
    
    // Restore previous selection if it still exists
    if (currentValue && presets[currentValue]) {
        selector.val(currentValue);
    } else {
        selector.val('default');
    }
    
    console.log('✅ Preset dropdown populated with', Object.keys(presets).length, 'presets');
}

function setupTemplateEventListeners() {
    console.log('🎧 Setting up modern template event listeners...');
    
    // Template search functionality
    $('#bmt-template-search').off('input.template').on('input.template', function() {
        const searchTerm = $(this).val().toLowerCase();
        $('.bmt-template-item').each(function() {
            const templateName = $(this).find('.bmt-template-name').text().toLowerCase();
            const templateMeta = $(this).find('.bmt-template-meta').text().toLowerCase();
            const visible = templateName.includes(searchTerm) || templateMeta.includes(searchTerm);
            $(this).toggle(visible);
        });
    });
    
    // Advanced Editor button
    $('#bmt-open-advanced-editor').off('click.template').on('click.template', async function() {
        const selectedKey = window.bmtCurrentTemplate;
        if (selectedKey) {
            await openAdvancedEditor(selectedKey);
        }
    });
    
    // Advanced editor event handlers
    $('#bmt-advanced-content').off('input.template').on('input.template', function() {
        updateCharCount();
        // Debounced macro detection refresh
        clearTimeout(window.bmtMacroRefreshTimeout);
        window.bmtMacroRefreshTimeout = setTimeout(() => {
            refreshMacroDetection();
        }, 500);
    });
    
    $('#bmt-refresh-macros').off('click.template').on('click.template', function() {
        refreshMacroDetection();
    });
    
    $('#bmt-save-advanced').off('click.template').on('click.template', async function() {
        await saveAdvancedTemplate();
    });
    
    $('#bmt-cancel-advanced, #bmt-close-advanced-editor').off('click.template').on('click.template', function() {
        closeAdvancedEditor();
    });
    
    $('#bmt-reset-template').off('click.template').on('click.template', function() {
        resetAdvancedTemplate();
    });
    
    // Close modal when clicking overlay
    $('#bmt-advanced-editor-modal .bmt-modal-overlay').off('click.template').on('click.template', function() {
        closeAdvancedEditor();
    });
    
    // Prevent modal close when clicking content
    $('#bmt-advanced-editor-modal .bmt-modal-content').off('click.template').on('click.template', function(e) {
        e.stopPropagation();
    });
    
    
    // Reset ALL templates to defaults - "I'm scared" button
    $('#bmt-reset-all-templates').off('click.template').on('click.template', function() {
        const confirmMessage = 'Are you SURE you want to reset ALL BunnyMo templates to factory defaults?\n\nThis will DELETE all your custom templates and modifications!\n\nThis action cannot be undone!';
        
        if (confirm(confirmMessage)) {
            const doubleConfirm = 'Last chance! This will permanently delete ALL your template customizations.\n\nType "RESET" to confirm:';
            const userInput = prompt(doubleConfirm);
            
            if (userInput === 'RESET') {
                if (templateManager.resetAllToDefaults()) {
                    console.log('🚨 ALL templates reset to defaults');
                    
                    // Refresh everything
                    populateTemplateDropdown();
                    populatePresetDropdown();
                    $('#bmt-preset-selector').val('default');
                    
                    const firstTemplate = $('#bmt-template-selector option:first').val();
                    if (firstTemplate) {
                        $('#bmt-template-selector').val(firstTemplate).trigger('change');
                    }
                    
                    toastr.success('All templates reset to factory defaults!', 'Reset Complete');
                } else {
                    toastr.error('Failed to reset templates');
                }
            } else {
                toastr.info('Reset cancelled - your templates are safe!');
            }
        }
    });
    
    // Preset management event handlers
    $('#bmt-preset-selector').off('change.template').on('change.template', function() {
        const presetName = $(this).val();
        if (!presetName || !templateManager) return;
        
        console.log('📦 Loading preset:', presetName);
        const result = templateManager.loadPreset(presetName);
        
        if (result.success) {
            // Refresh UI after loading preset
            populateTemplateDropdown();
            
            const firstTemplate = $('#bmt-template-selector option:first').val();
            if (firstTemplate) {
                $('#bmt-template-selector').val(firstTemplate).trigger('change');
            }
            
            toastr.success(`Loaded preset: ${presetName}`);
        } else {
            toastr.error(`Failed to load preset: ${result.error}`);
            // Revert dropdown to previous selection
            populatePresetDropdown();
        }
    });
    
    // Save custom preset
    $('#bmt-save-custom-preset').off('click.template').on('click.template', function() {
        const presetName = prompt('Enter a name for your custom template preset:');
        if (!presetName) return;
        
        if (!templateManager) {
            toastr.error('Template manager not available');
            return;
        }
        
        const result = templateManager.saveAsPreset(presetName);
        if (result.success) {
            populatePresetDropdown();
            $('#bmt-preset-selector').val(presetName);
            toastr.success(`Saved custom preset: ${presetName}`);
        } else {
            toastr.error(`Failed to save preset: ${result.error}`);
        }
    });
    
    // Export preset
    $('#bmt-export-preset').off('click.template').on('click.template', function() {
        if (!templateManager) {
            toastr.error('Template manager not available');
            return;
        }
        
        const currentPreset = $('#bmt-preset-selector').val() || 'BunnyMo_Templates';
        const exportData = templateManager.exportAsPreset(currentPreset);
        
        // Download as file
        const blob = new Blob([exportData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentPreset}_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        toastr.success(`Exported preset: ${currentPreset}`);
    });
    
    // Import preset
    $('#bmt-import-preset').off('click.template').on('click.template', function() {
        $('#bmt-preset-file-input').click();
    });
    
    $('#bmt-preset-file-input').off('change.template').on('change.template', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                if (!templateManager) {
                    toastr.error('Template manager not available');
                    return;
                }
                
                const result = templateManager.importPreset(e.target.result);
                if (result.success) {
                    // Refresh UI
                    populateTemplateDropdown();
                    
                    const firstTemplate = $('#bmt-template-selector option:first').val();
                    if (firstTemplate) {
                        $('#bmt-template-selector').val(firstTemplate).trigger('change');
                    }
                    
                    toastr.success(`Imported preset: ${result.name}`);
                } else {
                    toastr.error(`Import failed: ${result.error}`);
                }
            } catch (error) {
                toastr.error('Failed to read preset file');
                console.error('Preset import error:', error);
            }
        };
        reader.readAsText(file);
        
        // Clear the input
        $(this).val('');
    });
}

function updateTemplateInfoDisplay(template) {
    if (!template) return;
    
    const isActive = isTemplateActivelyUsed($('#bmt-template-selector').val());
    const statusIcon = isActive ? '🟢 LIVE' : '⚪ Inactive';
    const variables = template.variables || [];
    
    // Get detailed variable descriptions following qvink_memory's methodology
    const variableDescriptions = getVariableDescriptions();
    
    let variablesHtml = 'None';
    if (variables.length > 0) {
        variablesHtml = '<div style="margin-top: 8px;">';
        variables.forEach(variable => {
            const description = variableDescriptions[variable] || 'Variable content';
            variablesHtml += `
                <div style="margin: 4px 0; padding: 4px 8px; background: rgba(255, 165, 0, 0.1); border-radius: 3px; border-left: 3px solid #FFA500;">
                    <code style="color: #FFA500; font-weight: 500;">{{${variable}}}</code> - ${description}
                </div>
            `;
        });
        variablesHtml += '</div>';
    }
    
    // Add usage context based on template category
    const usageInfo = getTemplateUsageInfo(template);
    
    const infoHtml = `
        <div style="margin-bottom: 12px;">
            <div style="margin-bottom: 4px;"><strong>Status:</strong> ${statusIcon} ${isActive ? 'Currently being used by BunnyMo' : 'Not currently active'}</div>
            <div style="margin-bottom: 4px;"><strong>Category:</strong> ${template.category} | <strong>Role:</strong> ${template.role || 'system'}</div>
            <div style="margin-bottom: 4px;"><strong>Usage:</strong> ${usageInfo}</div>
        </div>
        
        <div style="margin-bottom: 12px;">
            <strong>Available Template Variables:</strong>
            ${variablesHtml}
        </div>
        
        <div style="padding: 8px; background: ${template.isDefault ? 'rgba(255, 165, 0, 0.05)' : 'rgba(76, 175, 80, 0.05)'}; border-radius: 4px; font-size: 0.9em;">
            ${template.isDefault ? '⚡ <strong>Default Template</strong> - Official BunnyMo template. Click "Reset" to restore if modified.' : '✏️ <strong>Custom Template</strong> - Your changes are saved automatically as you type.'}
        </div>
    `;
    
    $('#bmt-template-info').html(infoHtml);
    
    // Show variable insertion buttons if template has variables
    if (variables.length > 0) {
        createVariableInsertionButtons(variables);
        $('#bmt-variable-buttons').show();
    } else {
        $('#bmt-variable-buttons').hide();
    }
}

// Variable descriptions following qvink_memory's methodology
function getVariableDescriptions() {
    return {
        'USER_REQUEST': 'The user\'s character generation request text',
        'SELECTED_TRAITS': 'Currently selected character traits from BunnyMo interface',
        'BUNNYMO_DESCRIPTION': 'System information about BunnyMo functionality',
        'CHARACTER_CONTEXT': 'Existing character card information if available',
        'WORLD_INFO': 'Active World Information entries for context',
        'CHAT_CONTEXT': 'Recent chat messages for character understanding',
        'LOREBOOK_CONTENT': 'Relevant lorebook entries from selected books',
        'AVAILABLE_TAGS': 'Available BunnyMo tags from your tag libraries',
        'CHARACTER_DATA': 'Formatted character information for AI injection',
        'SYSTEM_DESCRIPTION': 'BunnyMo system capabilities and features',
        'CHARACTER_CARD': 'Full character card data in SillyTavern format',
        'MESSAGES': 'Chat message history for character context'
    };
}

// Template usage information based on category
function getTemplateUsageInfo(template) {
    const categoryInfo = {
        'generation': 'Used when generating new characters with BunnyRecc system',
        'injection': 'Automatically injected into AI context when BunnyMo detects characters',
        'format': 'Controls output formatting for character generation results'
    };
    
    const categoryDescription = categoryInfo[template.category] || 'Template usage information';
    
    // Add specific usage notes for known templates
    const specificUsage = {
        'bunnyReccSystemPrompt': 'Main system prompt that guides BunnyRecc character generation',
        'characterInjectionDefault': 'Injected when "AI Integration" is enabled and characters are detected',
        'characterInjectionAlternative': 'Alternative injection format for character data',
        'fullsheetFormatHeader': 'Used when generating full character sheets',
        'quicksheetFormatHeader': 'Used when generating quick character summaries'
    };
    
    const templateKey = $('#bmt-template-selector').val();
    return specificUsage[templateKey] || categoryDescription;
}

// Create variable insertion buttons following qvink_memory's methodology
function createVariableInsertionButtons(variables) {
    const container = $('#bmt-variable-button-container');
    container.empty();
    
    const variableDescriptions = getVariableDescriptions();
    
    variables.forEach(variable => {
        const description = variableDescriptions[variable] || 'Template variable';
        const button = $(`
            <button class="bmt-variable-insert-btn" 
                    data-variable="${variable}" 
                    title="${description}"
                    style="padding: 4px 8px; margin: 2px; background: var(--grey70); border: 1px solid var(--SmartThemeBorderColor); border-radius: 3px; cursor: pointer; font-size: 0.8em; color: var(--SmartThemeBodyColor);">
                {{${variable}}}
            </button>
        `);
        
        button.on('click', function() {
            insertVariableAtCursor(variable);
        });
        
        button.on('mouseenter', function() {
            $(this).css({
                'background': 'rgba(255, 165, 0, 0.1)',
                'border-color': '#FFA500'
            });
        });
        
        button.on('mouseleave', function() {
            $(this).css({
                'background': 'var(--grey70)',
                'border-color': 'var(--SmartThemeBorderColor)'
            });
        });
        
        container.append(button);
    });
}

// Insert variable at cursor position in textarea
function insertVariableAtCursor(variable) {
    const textarea = $('#bmt-template-content')[0];
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const variableText = `{{${variable}}}`;
    
    // Insert the variable at cursor position
    const newText = text.substring(0, start) + variableText + text.substring(end);
    textarea.value = newText;
    
    // Move cursor to end of inserted variable
    const newCursorPos = start + variableText.length;
    textarea.focus();
    textarea.setSelectionRange(newCursorPos, newCursorPos);
    
    // Trigger change event to save the template
    $(textarea).trigger('input');
    
    // Show feedback
    toastr.success(`Inserted {{${variable}}} at cursor position`);
}

// Debug function for manual testing
window.BMT_debugTemplates = function() {
    console.log('🔍 DEBUG: extension_settings available:', typeof extension_settings !== 'undefined');
    console.log('🔍 DEBUG: Template manager status:', !!templateManager);
    console.log('🔍 DEBUG: Template selector element:', $('#bmt-template-selector').length);
    console.log('🔍 DEBUG: Template manager templates:', templateManager ? Object.keys(templateManager.getAllTemplates()) : 'N/A');
    
    if (templateManager) {
        console.log('🔍 DEBUG: Refreshing template dropdown...');
        if (typeof extension_settings !== 'undefined') {
            templateManager.reloadUserTemplates();
        }
        populateTemplateDropdown();
        
        const firstTemplate = $('#bmt-template-selector option:first').val();
        if (firstTemplate) {
            $('#bmt-template-selector').val(firstTemplate).trigger('change');
            console.log('🔍 DEBUG: Selected first template:', firstTemplate);
        }
    } else {
        console.log('🔍 DEBUG: Template manager not available');
    }
}

function updateVariableDisplay(variables) {
    const container = $('#bmt-template-variables');
    container.empty();
    
    if (!variables || variables.length === 0) {
        container.append('<p class="bmt-no-variables">No variables available for this template</p>');
        return;
    }
    
    variables.forEach(variable => {
        const variableElement = $(`
            <div class="bmt-variable-item" data-variable="${variable}">
                <span class="bmt-variable-name">{{${variable}}}</span>
                <span class="bmt-variable-hint">Click to insert</span>
            </div>
        `);
        container.append(variableElement);
    });
}

function saveCurrentTemplate() {
    const templateKey = $('#bmt-template-editor').data('editing-template');
    const content = $('#bmt-template-editor').val();
    
    if (!templateKey || !content) {
        toastr.warning('Please select a template and provide content');
        return;
    }
    
    if (!templateManager) {
        toastr.error('Template manager not initialized');
        return;
    }
    
    const template = templateManager.getTemplate(templateKey);
    if (template) {
        // Get current role from the role selector
        const currentRole = $(`[data-template-role="${templateKey}"]`).val() || template.role || 'system';
        
        const updatedTemplate = {
            ...template,
            content: content,
            role: currentRole
        };
        
        templateManager.setTemplate(templateKey, updatedTemplate);
        toastr.success('Template saved successfully');
        
        // Update the template list to show it's no longer default
        updateTemplateSelector($('#bmt-template-category').val());
    }
}

function resetCurrentTemplate() {
    const templateKey = $('#bmt-template-selector').val();
    
    if (!templateKey) {
        toastr.warning('Please select a template to reset');
        return;
    }
    
    if (!templateManager) {
        toastr.error('Template manager not initialized');
        return;
    }
    
    if (templateManager.resetTemplate(templateKey)) {
        const template = templateManager.getTemplate(templateKey);
        $('#bmt-template-editor').val(template.content);
        updateVariableDisplay(template.variables || []);
        updateTemplateSelector($('#bmt-template-category').val());
        $('#bmt-template-selector').val(templateKey);
        toastr.success('Template reset to default');
    } else {
        toastr.error('Could not reset template - no default available');
    }
}

function validateCurrentTemplate() {
    const content = $('#bmt-template-editor').val();
    const templateKey = $('#bmt-template-selector').val();
    
    if (!content) {
        toastr.warning('Please provide template content to validate');
        return;
    }
    
    if (!templateManager) {
        toastr.error('Template manager not initialized');
        return;
    }
    
    const template = templateManager.getTemplate(templateKey);
    const expectedVariables = template ? template.variables || [] : [];
    
    const validation = templateManager.validateTemplate(content, expectedVariables);
    
    if (validation.isValid) {
        toastr.success('Template validation passed ✓');
    } else {
        toastr.error(`Template validation failed:<br>${validation.errors.join('<br>')}`);
    }
}

function previewCurrentTemplate() {
    const content = $('#bmt-template-editor').val();
    
    if (!content) {
        toastr.warning('Please provide template content to preview');
        return;
    }
    
    if (!templateManager) {
        toastr.error('Template manager not initialized');
        return;
    }
    
    // Create sample data for preview
    const sampleData = {
        CHARACTER_DATA: '[Sample Character Data]',
        CHARACTER_NAMES: 'Alice, Bob',
        CHARACTER_COUNT: '2',
        USER_REQUEST: 'Create a fantasy character',
        SELECTED_TRAITS: '• Personality: Brave\n• Species: Elf',
        SYSTEM_DESCRIPTION: 'BunnyMo Character Generation System',
        WORLD_INFO: 'Fantasy world with magic and dragons',
        CHAT_CONTEXT: 'Recent conversation about adventures',
        AVAILABLE_TAGS: 'species:elf, personality:brave, class:warrior'
    };
    
    const rendered = templateManager.renderTemplate('temp', { content }, sampleData);
    
    $('#bmt-template-preview-content').html(`<pre>${escapeHtml(rendered)}</pre>`);
    $('#bmt-template-preview-modal').fadeIn(200);
}

function exportTemplates() {
    if (!templateManager) {
        toastr.error('Template manager not initialized');
        return;
    }
    
    const exportData = templateManager.exportTemplates();
    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `bunnymo-templates-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toastr.success('Templates exported successfully');
}

function importTemplates() {
    const jsonData = $('#bmt-import-data').val();
    
    if (!jsonData) {
        toastr.warning('Please provide JSON data to import');
        return;
    }
    
    if (!templateManager) {
        toastr.error('Template manager not initialized');
        return;
    }
    
    const result = templateManager.importTemplates(jsonData);
    
    if (result.success) {
        toastr.success(`Successfully imported ${result.count} templates`);
        $('#bmt-import-modal').fadeOut(200);
        $('#bmt-import-data').val('');
        
        // Refresh UI
        updateTemplateSelector($('#bmt-template-category').val());
    } else {
        toastr.error(`Import failed: ${result.error}`);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function createFallbackInjection(characterData) {
    return `[MANDATORY CHARACTER CONTEXT - Process Before Generating]

The following characters are active in this conversation. You MUST acknowledge and incorporate their traits, personality, and characteristics in your response:

${characterData}

This character information takes PRIORITY over other context. Ensure your response is consistent with these established character traits and behaviors.`;
}

// Update token optimization preview
function updateTokenPreview() {
    const settings = extension_settings[extensionName] || defaultSettings;
    const characterData = createCardBasedCharacterData();
    
    if (!characterData || characterData.characters.length === 0) {
        $('#bmt-token-preview').hide();
        return;
    }
    
    try {
        // Import token optimizer functions dynamically
        import('./tokenOptimizer.js').then(({ optimizeForAI, calculateTokenSavings }) => {
            const optimizationSettings = {
                maxCharacters: settings.aiMaxCharacters || 4,
                priorityTags: settings.aiPriorityTags || ['species', 'personality', 'physical'],
                maxTagsPerCategory: settings.aiMaxTagsPerCategory || 2,
                compactFormat: settings.aiUseCompactFormat !== false
            };
            
            const optimizedData = optimizeForAI(characterData, optimizationSettings);
            const savings = calculateTokenSavings(characterData, optimizedData);
            
            $('#bmt-token-original').text(`${savings.originalTokens} tokens`);
            $('#bmt-token-optimized').text(`${savings.optimizedTokens} tokens`);
            $('#bmt-token-savings').text(`${savings.savingsPercent}% (${savings.savings} tokens)`);
            
            $('#bmt-token-preview').show();
        }).catch(error => {
            console.warn('Token preview update failed:', error);
            $('#bmt-token-preview').hide();
        });
    } catch (error) {
        console.warn('Token preview calculation failed:', error);
        $('#bmt-token-preview').hide();
    }
}

// Enhanced initialization
function enhancedInitialization() {
    // Setup new UI elements
    setTimeout(() => {
        setupNewSettingsUI();
        setupNewSettingsEventListeners();
        updateTokenPreview();
        logSeq('🎨 New settings UI initialized');
    }, 500);
}

// Auto-initialize system when extension loads
setTimeout(() => {
    initBunnyMoSystemMessage(); // Initialize our custom system message type
    
    // 📝 Initialize template management system
    initializeTemplateManager(extensionName);
    console.log('✨ BunnyMo Template Manager initialized');
    
    // Wait for extension_settings to be available, then reload templates and setup UI
    setTimeout(async () => {
        if (typeof extension_settings !== 'undefined' && templateManager) {
            console.log('🔄 Extension settings available, reloading user templates...');
            templateManager.reloadUserTemplates();
            
            // Load dynamic templates from selected lorebooks
            await loadDynamicTemplatesFromLorebooks();
            
            // Ensure fallback templates exist
            templateManager.ensureTemplatesWithFallbacks();
        }
        
        console.log('🎨 Initializing template UI after manager setup...');
        console.log('🔍 Template manager check before UI init:', !!templateManager);
        if (templateManager) {
            console.log('📋 Templates available before UI init:', Object.keys(templateManager.getAllTemplates()).length);
        }
        await initializeTemplateUI();
    }, 500); // Give more time for SillyTavern to fully load
    
    // 🐰 Initialize BunnyRecc character generation module (includes per-chat config)
    initializeBunnyRecc().then(() => {
        console.log('✨ BunnyRecc: Character generator with per-chat configuration ready!');
    }).catch(error => {
        console.error('🚫 BunnyRecc: Failed to initialize character generator:', error);
    });
    
    // 🔄 RESTORE CARDS ON EXTENSION LOAD
    setTimeout(() => {
        BMT_restoreAllCards();
    }, 1000); // Give ST time to fully load
    
    // DISABLED: Old card system - using system messages now
    // initializeCardSystem();
    // enhancedInitialization();
}, 1000);

// ============================================================================
// UNIFIED DEBUG SYSTEM - ORGANIZED BY MAJOR SYSTEMS
// ============================================================================

let debugLogs = [];
const MAX_DEBUG_LOGS = 30; // Keep it manageable

// Debug categories for organized logging
const DEBUG_CATEGORIES = {
    SYSTEM: '🔧', // Master toggle, initialization, core system
    CARDS: '🎴', // Card creation, display, attachment  
    AI: '🤖', // AI injection, prompt processing
    SETTINGS: '⚙️', // Settings changes, validation
    EVENTS: '📡', // Event handlers, listeners
    ERROR: '💥' // Errors and failures
};

// Clean debug function with categories - only logs when debug mode enabled
function debug(category, message, data = null) {
    const settings = extension_settings[extensionName] || defaultSettings;
    if (!settings.debugMode) return;
    
    const icon = DEBUG_CATEGORIES[category] || '📝';
    const cleanMessage = `${icon} ${category}: ${message}`;
    const timestamp = new Date().toTimeString().split(' ')[0];
    
    // Store in logs
    debugLogs.unshift({ timestamp, category, message: cleanMessage, data });
    if (debugLogs.length > MAX_DEBUG_LOGS) debugLogs.pop();
    
    // Clean console output with searchable prefixes
    const prefix = `[BMT ${category}]`;
    if (data) {
        console.log(`${prefix} ${icon} ${message}`, data);
    } else {
        console.log(`${prefix} ${icon} ${message}`);
    }
    
    updateDebugPanel();
}

// Organized debug helpers for each major system
const Debug = {
    system: (msg, data) => debug('SYSTEM', msg, data),
    cards: (msg, data) => debug('CARDS', msg, data),
    ai: (msg, data) => debug('AI', msg, data),
    settings: (msg, data) => debug('SETTINGS', msg, data),
    events: (msg, data) => debug('EVENTS', msg, data),
    error: (msg, data) => debug('ERROR', msg, data)
};

function createDebugPanel() {
    // Remove existing panel
    const existing = document.getElementById('bmt-debug-panel');
    if (existing) existing.remove();
    
    const panel = document.createElement('div');
    panel.id = 'bmt-debug-panel';
    panel.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        width: 400px;
        max-height: 300px;
        background: rgba(0, 0, 0, 0.9);
        color: #FFA500;
        border: 2px solid #FFA500;
        border-radius: 8px;
        padding: 10px;
        font-family: monospace;
        font-size: 12px;
        z-index: 10000;
        overflow-y: auto;
        display: none;
    `;
    
    const header = document.createElement('div');
    header.innerHTML = `
        <strong>🥕 BunnyMoTags Debug Console</strong>
        <button onclick="this.parentElement.parentElement.style.display='none'" style="float: right; background: #FFA500; border: none; color: black; padding: 2px 6px; border-radius: 3px; cursor: pointer;">✕</button>
        <button onclick="debugLogs = []; updateDebugPanel();" style="float: right; margin-right: 5px; background: #FFA500; border: none; color: black; padding: 2px 6px; border-radius: 3px; cursor: pointer;">Clear</button>
    `;
    
    const content = document.createElement('div');
    content.id = 'bmt-debug-content';
    content.style.cssText = 'margin-top: 10px; max-height: 250px; overflow-y: auto;';
    
    panel.appendChild(header);
    panel.appendChild(content);
    document.body.appendChild(panel);
    
    return panel;
}

function updateDebugPanel() {
    const content = document.getElementById('bmt-debug-content');
    if (!content) return;
    
    content.innerHTML = debugLogs.map(log => {
        // Color coding by category
        const colors = {
            'SYSTEM': '#4facfe',
            'CARDS': '#ff6b6b', 
            'AI': '#2ecc71',
            'SETTINGS': '#f39c12',
            'EVENTS': '#9b59b6',
            'ERROR': '#e74c3c'
        };
        const color = colors[log.category] || '#FFA500';
        
        return `<div style="color: ${color}; margin-bottom: 3px; font-size: 11px;">
            <span style="opacity: 0.7;">[${log.timestamp}]</span> ${log.message}
            ${log.data ? `<div style="margin-left: 10px; opacity: 0.6; font-size: 10px;">${JSON.stringify(log.data).substring(0, 100)}${JSON.stringify(log.data).length > 100 ? '...' : ''}</div>` : ''}
        </div>`;
    }).join('');
    
    content.scrollTop = 0;
}

function showDebugPanel() {
    let panel = document.getElementById('bmt-debug-panel');
    if (!panel) panel = createDebugPanel();
    panel.style.display = 'block';
    updateDebugPanel();
}

// Add debug panel toggle to global scope
window.showBMTDebug = showDebugPanel;

/**
 * Add simple 🥕 indicator to AI messages that receive character data injection
 */
function addSimpleCharacterIndicator(characterData) {
    try {
        Debug.cards('Adding simple character indicator to latest AI message', {
            characterCount: characterData?.characters?.length
        });
        
        // Find the most recent AI message
        let latestAIMessage = null;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i].is_user && !chat[i].is_system) {
                latestAIMessage = chat[i];
                break;
            }
        }
        
        if (!latestAIMessage) {
            Debug.cards('No AI message found for indicator');
            return;
        }
        
        // Find the corresponding DOM element
        const messageElements = document.querySelectorAll('[mesid]');
        let targetElement = null;
        
        for (let element of messageElements) {
            const mesId = parseInt(element.getAttribute('mesid'));
            if (chat[mesId] === latestAIMessage) {
                targetElement = element;
                break;
            }
        }
        
        if (!targetElement) {
            Debug.cards('No DOM element found for latest AI message');
            return;
        }
        
        // Check if indicator already exists
        if (targetElement.querySelector('.bmt-simple-indicator')) {
            Debug.cards('Simple indicator already exists on this message');
            return;
        }
        
        // Create simple indicator
        const indicator = document.createElement('div');
        indicator.className = 'bmt-simple-indicator';
        indicator.style.cssText = `
            position: absolute;
            top: 5px;
            right: 5px;
            background: rgba(255, 165, 0, 0.9);
            color: white;
            padding: 2px 6px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
            z-index: 1000;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            user-select: none;
            pointer-events: none;
        `;
        
        const characterCount = characterData.characters ? characterData.characters.length : 0;
        indicator.textContent = `🥕 ${characterCount}`;
        indicator.title = `BunnyMo character data injected (${characterCount} characters)`;
        
        // Make sure the parent message has relative positioning
        targetElement.style.position = 'relative';
        
        // Add indicator to message
        targetElement.appendChild(indicator);
        
        Debug.cards(`Simple indicator added successfully`, { characterCount });
        
    } catch (error) {
        Debug.error('Failed to add simple indicator', { error: error.message });
    }
}


// GLOBAL PROMPT INTERCEPTOR FUNCTION (called by SillyTavern before AI generation)
window.bunnyMoTagsInterceptor = function(chatArray, contextSize, abortController, generationType) {
    try {
        // Check if extension is enabled first
        const settings = extension_settings[extensionName] || defaultSettings;
        if (!settings.enabled) {
            logSeq('🔇 BunnyMoTags disabled by Master Enable toggle, skipping processing');
            return chatArray;
        }
        
        logSeq(`🔍 Prompt interceptor called with ${chatArray.length} messages`);
        
        // EXTENSION COMPATIBILITY: Check if other extensions have already processed this
        if (!chatArray || chatArray.length === 0) {
            logSeq('⚠️ Empty chat array received, skipping BunnyMoTags processing');
            return chatArray;
        }
        
        // Check the last user message for bunnymo blocks
        let lastUserMessage = null;
        let userMessageIndex = -1;
        for (let i = chatArray.length - 1; i >= 0; i--) {
            if (chatArray[i].is_user) {
                lastUserMessage = chatArray[i];
                userMessageIndex = i;
                break;
            }
        }
        
        if (!lastUserMessage || !lastUserMessage.mes) {
            logSeq('❌ No user message found, skipping BunnyMoTags processing');
            return chatArray; // No user message found
        }
        
        // Look for bunnymo code blocks in the user message
        const bunnymoRegex = /```bunnymo\n(.*?)\n```/gs;
        const matches = Array.from(lastUserMessage.mes.matchAll(bunnymoRegex));
        
        if (matches.length === 0) {
            return chatArray; // No bunnymo blocks found
        }
        
        logSeq(`📦 Found ${matches.length} bunnymo block(s) in user message`);
        
        // Parse all bunnymo blocks
        const allCharacterData = { characters: [] };
        let shouldCleanMessage = false;
        
        matches.forEach((match, index) => {
            const bunnymoContent = match[1].trim();
            const parsedData = parseBunnyMoData(bunnymoContent);
            
            if (parsedData && parsedData.characters) {
                allCharacterData.characters.push(...parsedData.characters);
                shouldCleanMessage = true;
                logSeq(`✅ Parsed bunnymo block ${index + 1}: ${parsedData.characters.length} character(s)`);
            }
        });
        
        if (allCharacterData.characters.length === 0) {
            return chatArray; // No valid character data found
        }
        
        // EXTENSION COMPATIBILITY: Create deep copy to avoid modifying original array
        const modifiedChatArray = JSON.parse(JSON.stringify(chatArray));
        const modifiedUserMessage = modifiedChatArray[userMessageIndex];
        
        // Clean bunnymo blocks from user message if settings allow
        if (shouldCleanMessage && settings.cleanBunnymoBlocks !== false) {
            modifiedUserMessage.mes = modifiedUserMessage.mes.replace(bunnymoRegex, '').trim();
            logSeq('🧹 Cleaned bunnymo blocks from user message (non-destructive copy)');
        }
        
        // EXTENSION COMPATIBILITY: Check if we should inject system messages
        // Skip if there are already BunnyMo system messages to avoid duplicates
        const existingBunnyMoMessages = modifiedChatArray.filter(msg => 
            msg.extra && msg.extra.type === BUNNYMO_SYSTEM_MESSAGE_TYPE
        );
        
        if (existingBunnyMoMessages.length > 0) {
            logSeq('⚠️ BunnyMo system messages already exist, skipping injection to avoid conflicts');
            return chatArray;
        }
        
        // Create system message with character cards
        const systemMessage = {
            name: systemUserName,
            force_avatar: system_avatar,
            is_user: false,
            is_system: true,
            mes: '', // Will be set by sendBunnyMoSystemMessage
            send_date: getMessageTimeStamp(),
            extra: {
                type: BUNNYMO_SYSTEM_MESSAGE_TYPE,
                isSmallSys: false,
                bunnyMoData: allCharacterData,
                bunnyMoInterceptor: true // Mark as interceptor-generated
            }
        };
        
        // Ensure CSS is loaded for the cards (non-blocking)
        try {
            if (!document.getElementById('bmt-card-styles')) {
                const link = document.createElement('link');
                link.id = 'bmt-card-styles';
                link.rel = 'stylesheet';
                link.type = 'text/css';
                link.href = '/scripts/extensions/third-party/BunnyMoTags/style.css';
                document.head.appendChild(link);
                logSeq('📎 Loaded BunnyMo card styles');
            }
        } catch (cssError) {
            logSeq('⚠️ Failed to load CSS, continuing without styling');
        }
        
        // Create message content with JSON for the new template renderer
        const characterCount = allCharacterData.characters.length;
        let messageContent = `🥕 Character Information (${characterCount} ${characterCount === 1 ? 'character' : 'characters'})\n\n`;
        messageContent += '```bunnymo\n';
        messageContent += JSON.stringify(allCharacterData, null, 2);
        messageContent += '\n```';
        systemMessage.mes = messageContent;
        
        // EXTENSION COMPATIBILITY: Add system message at the end to minimize interference
        // This allows other extensions to process the chat first
        modifiedChatArray.push(systemMessage);
        
        logSeq(`🎉 INTERCEPTOR SUCCESS: Injected system message with ${allCharacterData.characters.length} character card(s) (extension-safe)`);
        logSeq(`📊 Final chat array length: ${modifiedChatArray.length} (original: ${chatArray.length})`);
        
        // Store character data for simple indicator (if Full Character Cards is disabled)
        window.bmtLastInjectedData = allCharacterData;
        Debug.ai(`Stored character data for potential simple indicator: ${allCharacterData.characters.length} characters`);
        
        return modifiedChatArray;
        
    } catch (error) {
        console.error(`[BunnyMoTags] Interceptor error (extension compatibility mode):`, error);
        logSeq(`❌ Interceptor failed, returning original chat array to avoid breaking other extensions`);
        return chatArray; // Return original on error to avoid breaking other extensions
    }
};

// Template Prompt Edit Interface - copied exactly from qvink_memory
class TemplatePromptEditInterface {

    html_template = `
<div id="bmt_template_prompt_interface" class="bmt-template-interface" style="height: 100%">
<div class="bmt-modal-header-banner">
    <div class="bmt-modal-title">
        <span class="bmt-modal-icon">🐰</span>
        <h3>BunnyMo Template Editor</h3>
        <span class="bmt-modal-subtitle">Configure templates and macros</span>
    </div>
    <div class="bmt-template-controls">
        <label class="bmt-template-selector-label" title="Select which template to edit">
            <span class="bmt-selector-label">🎯 Template:</span>
            <select id="bmt_template_selector" class="bmt-template-select">
                <option value="">✨ Select a template...</option>
            </select>
        </label>
        <button class="menu_button fa-solid fa-list-check margin0 qm-small open_macros bmt-toggle-btn" title="Show/hide macro editor">📱</button>
    </div>
</div>

<!-- Moved sections below to vertical layout -->

<div class="bmt-editor-content" style="display: flex; flex-direction: column; gap: 15px;">
    <div class="bmt-template-section">
        <div class="bmt-panel-header">
            <div class="bmt-panel-title">
                <span class="bmt-panel-icon">📝</span>
                <h3>Template Content</h3>
            </div>
            <div class="bmt-panel-controls">
                <label class="bmt-type-selector" title="Template type">
                    <span>🏷️ Type:</span>
                    <select id="template_type" class="bmt-template-type-select">
                        <option value="system">⚙️ System</option>
                        <option value="character">👤 Character</option>
                        <option value="world">🌍 World</option>
                    </select>
                </label>
                <button id="preview_template_prompt" class="bmt-action-btn bmt-preview-btn" title="Preview current template prompt">
                    <i class="fa-solid fa-eye"></i> Preview
                </button>
                <button id="save_template" class="bmt-action-btn bmt-save-btn" title="Save current template changes">
                    <i class="fa-solid fa-save"></i> Save
                </button>
                <button id="duplicate_template" class="bmt-action-btn bmt-duplicate-btn" title="Create a custom copy of this template">
                    <i class="fa-solid fa-copy"></i> Duplicate
                </button>
                <button id="delete_template" class="bmt-action-btn bmt-delete-btn" title="Delete this custom template">
                    <i class="fa-solid fa-trash"></i> Delete
                </button>
                <button id="restore_default_template" class="bmt-action-btn bmt-restore-btn" title="Restore the default template">
                    <i class="fa-solid fa-recycle"></i> Reset
                </button>
            </div>
        </div>
        <textarea id="prompt" placeholder="✨ Enter your BunnyMo template content here...&#10;&#10;Use {{MACRO_NAME}} for dynamic variables that will be replaced with configured values.&#10;&#10;Example:&#10;Character: {{CHARACTER_NAME}}&#10;Personality: {{PERSONALITY}}&#10;Available traits: {{AVAILABLE_TAGS}}"></textarea>
    </div>
    
    <div class="bmt-macro-section toggle-macro">
        <div class="bmt-panel-header">
            <div class="bmt-panel-title">
                <span class="bmt-panel-icon">🔧</span>
                <h3>Macro Configuration</h3>
            </div>
            <div class="bmt-panel-controls">
                <button id="add_macro" class="bmt-action-btn bmt-add-btn" title="Add a new custom macro">
                    <i class="fa-solid fa-plus"></i> New Macro
                </button>
            </div>
        </div>
        <div id="macro_definitions" class="bmt-macro-definitions"></div>
    </div>
</div>

<div class="bmt-template-metadata">
    <div class="bmt-metadata-section">
        <div class="bmt-metadata-row">
            <div class="bmt-metadata-field">
                <label class="bmt-metadata-label">
                    <span class="bmt-metadata-icon">📂</span>
                    <span class="bmt-metadata-title">Template Category</span>
                    <i class="fa-solid fa-info-circle bmt-tooltip" title="Select which BunnyMo feature this template is for:&#10;• BunnyRecc System Prompt: Main character generation prompt&#10;• Selected Traits Context: How selected traits are formatted&#10;• Character Data Injection: How character data gets injected&#10;• BunnyMo Fullsheet Format: Complete character sheet format&#10;• etc. - Choose the feature you want to customize"></i>
                </label>
                <select id="template_category" class="bmt-metadata-select">
                    <option value="BunnyRecc System Prompt">🐰 BunnyRecc System Prompt</option>
                    <option value="Selected Traits Context">🎯 Selected Traits Context</option>
                    <option value="BunnyMo System Information">📋 BunnyMo System Information</option>
                    <option value="Character Context Information">👤 Character Context Information</option>
                    <option value="World Information Context">🌍 World Information Context</option>
                    <option value="Chat Messages Context">💬 Chat Messages Context</option>
                    <option value="Lorebook Content Context">📚 Lorebook Content Context</option>
                    <option value="Available Tags Context">🏷️ Available Tags Context</option>
                    <option value="Character Data Injection">💉 Character Data Injection</option>
                    <option value="Generation Important Notes">📝 Generation Important Notes</option>
                    <option value="BunnyMo Fullsheet Format">📄 BunnyMo Fullsheet Format</option>
                    <option value="BunnyMo Quicksheet Format">⚡ BunnyMo Quicksheet Format</option>
                </select>
            </div>
            
            <div class="bmt-metadata-field">
                <label class="bmt-metadata-label">
                    <span class="bmt-metadata-icon">⭐</span>
                    <span class="bmt-metadata-title">Primary Template</span>
                    <i class="fa-solid fa-info-circle bmt-tooltip" title="When BunnyMo needs a template of this category, it will use the primary one first. Only one template per category should be marked as primary."></i>
                </label>
                <div class="bmt-toggle-container">
                    <input id="template_role" type="checkbox" class="bmt-primary-toggle" />
                    <label for="template_role" class="bmt-toggle-label">
                        <span class="bmt-toggle-slider"></span>
                        <span class="bmt-toggle-text">Make Primary</span>
                    </label>
                </div>
            </div>
        </div>
    </div>
</div>

</div>
`
    // Template dropdown and other settings
    selectedTemplate = null;
    
    macro_definition_template = `

<div class="macro_definition bmt_interface_card">
<div class="inline-drawer">
    <div class="inline-drawer-header">
        <div class="flex-container alignitemscenter margin0 flex1">
            <div class="bmt-macro-icon">🔧</div>
            <button class="macro_enable menu_button fa-solid margin0"></button>
            <button class="macro_preview menu_button fa-solid fa-eye margin0" title="Preview the result of this macro"></button>
            <input class="macro_name flex1 text_pole" type="text" placeholder="name" readonly>
        </div>
        <div class="inline-drawer-toggle">
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
    </div>

    <div class="inline-drawer-content">
        <!-- Macro Documentation -->
        <div class="bmt-macro-docs">
            <div class="bmt-macro-description"></div>
        </div>
        
        <div class="flex-container alignitemscenter justifyCenter">
            <div class="macro_type flex2">
                <label>
                    <input type="radio" value="simple" />
                    <span>🎯 Simple</span>
                </label>
                <label>
                    <input type="radio" value="advanced" />
                    <span>⚡ Advanced</span>
                </label>
            </div>
        </div>

        <!-- Simple Settings -->
        <div class="macro_type_simple">
            <div class="macro_simple_content">
                <!-- Content varies by macro type - populated dynamically -->
            </div>
        </div>

        <!-- Advanced Settings -->
        <div class="macro_type_advanced">
            <div class="macro_advanced_content">
                <!-- Content varies by macro type - populated dynamically -->
            </div>
        </div>

        <div class="macro_type_any flex-container alignitemscenter">
            <label title="Apply BunnyMo formatting to the output" class="checkbox_label">
                <input class="macro_format" type="checkbox">
                <span>🎨 Format Output</span>
            </label>

            <button class="macro_delete menu_button red_button fa-solid fa-trash" title="Delete custom macro" style="margin-left: auto;"></button>
            <button class="macro_restore menu_button red_button fa-solid fa-recycle" title="Restore default BunnyMo macro" style="margin-left: auto;"></button>
        </div>

    </div>
</div>
</div>

    `
    ctx = getContext();

    // enable/disable icons
    static fa_enabled = "fa-check"
    static fa_disabled = "fa-xmark"

    default_macro_settings = {
        name: "new_macro",
        enabled: true,
        type: "simple",
        value: "",
        format: false,
        command: "",
        // Macro-specific settings will be added based on macro type
    }

    constructor() {
        this.macros = {};
        this.initializeDefaultMacros();
        this.from_settings()
    }
    
    initializeDefaultMacros() {
        // Add some default BunnyMo macros that are always available
        const defaultMacros = {
            'CHARACTER_NAME': {
                name: 'CHARACTER_NAME',
                enabled: true,
                type: 'simple',
                charNameFormat: 'display',
                format: false,
                command: '',
                default: true
            },
            'USER_NAME': {
                name: 'USER_NAME',
                enabled: true,
                type: 'simple',
                nameFormat: 'display',
                format: false,
                command: '',
                default: true
            },
            'PERSONALITY': {
                name: 'PERSONALITY',
                enabled: true,
                type: 'simple',
                personalityStyle: 'traits',
                format: false,
                command: '',
                default: true
            }
        };
        
        // Only add default macros if they don't exist
        Object.entries(defaultMacros).forEach(([name, macro]) => {
            if (!this.macros[name]) {
                this.macros[name] = macro;
            }
        });
    }
    
    async init() {
        this.popup = new this.ctx.Popup(this.html_template, this.ctx.POPUP_TYPE.TEXT, undefined, {wider: true, okButton: 'Save', cancelButton: 'Cancel'});
        this.$content = $(this.popup.content)
        this.$buttons = this.$content.find('.popup-controls')
        this.$preview = this.$content.find('#preview_template_prompt')
        this.$save = this.$content.find('#save_template')
        this.$duplicate = this.$content.find('#duplicate_template')
        this.$delete = this.$content.find('#delete_template')
        this.$restore = this.$content.find('#restore_default_template')
        this.$definitions = this.$content.find('#macro_definitions')
        this.$add_macro = this.$content.find('#add_macro')
        this.$open_macros = this.$content.find('.open_macros')

        // settings
        this.$prompt = this.$content.find('#prompt')
        this.$template_type = this.$content.find('#template_type')
        this.$template_category = this.$content.find('#template_category')
        this.$template_role = this.$content.find('#template_role')
        this.$template_selector = this.$content.find('#bmt_template_selector')

        // manually set a larger width
        this.$content.closest('dialog').css('min-width', '80%')

        // buttons
        this.$preview.on('click', () => this.preview_prompt())
        this.$save.on('click', () => this.save_template())
        this.$duplicate.on('click', () => this.duplicate_template())
        this.$delete.on('click', () => this.delete_template())
        this.$add_macro.on('click', () => this.new_macro())
        this.$restore.on('click', () => this.restore_default())
        this.$open_macros.on('click', () => {
            this.$content.find('.toggle-macro').toggle()
        })

        // manually add tooltips to the popout buttons
        this.$buttons.find('.popup-button-ok').attr('title', 'Save changes to the template and macros')
        this.$buttons.find('.popup-button-cancel').attr('title', 'Discard changes to the template and macros')

        // set the prompt text and the macro settings
        this.from_settings()
        
        // Populate template selector dropdown
        this.populateTemplateSelector();
        
        // Template selector change handler
        this.$template_selector.on('change', () => {
            this.selectedTemplate = this.$template_selector.val();
            this.from_settings(); // Reload template content
            this.update_macros(); // Update macro list
        });
        
        // Add real-time macro detection
        this.$prompt.on('input', () => {
            this.detectMacrosFromTemplate();
            this.update_macros();
        });
    }
    
    populateTemplateSelector() {
        this.$template_selector.empty();
        this.$template_selector.append('<option value="">Select a template...</option>');
        
        // Add default templates from templateManager
        if (templateManager) {
            const allTemplates = templateManager.getAllTemplates();
            Object.entries(allTemplates).forEach(([key, template]) => {
                const option = $(`<option value="${key}">${template.label}</option>`);
                this.$template_selector.append(option);
            });
        }
        
        // Add custom templates from extension_settings
        if (extension_settings[extensionName]?.templates) {
            Object.entries(extension_settings[extensionName].templates).forEach(([key, template]) => {
                if (template.custom) {
                    const option = $(`<option value="${key}">${key} ✏️</option>`);
                    this.$template_selector.append(option);
                }
            });
        }
    }

    async show() {
        await this.init()
        this.update_macros()

        let result = await this.popup.show();  // wait for result
        if (result) {  // clicked save
            this.save_settings()
        }
        // Settings saved successfully
    }

    // Load settings from extension_settings
    from_settings() {
        if (!this.selectedTemplate) return;
        
        // Load template content from templateManager
        if (templateManager && templateManager.getTemplate) {
            const template = templateManager.getTemplate(this.selectedTemplate);
            if (template && this.$prompt) {
                this.$prompt.val(template.content || '');
                if (this.$template_type) this.$template_type.val(template.type || 'system');
                if (this.$template_category) {
                    const smartCategory = this.getSmartCategory(this.selectedTemplate, template);
                    this.$template_category.val(template.category || smartCategory);
                }
                if (this.$template_role) this.$template_role.prop('checked', template.primary || false);
                
                // Detect macros from loaded content
                this.detectMacrosFromTemplate();
            }
        }
    }
    
    getSmartCategory(templateName, template) {
        // Smart category detection based on actual BunnyMo template names
        const name = templateName.toLowerCase();
        const content = (template.content || '').toLowerCase();
        
        // Match actual template names from the system
        if (name.includes('bunnyrecc system') || name.includes('bunnyrecc prompt')) {
            return 'BunnyRecc System Prompt';
        }
        
        if (name.includes('selected traits') || name.includes('traits context')) {
            return 'Selected Traits Context';
        }
        
        if (name.includes('bunnymo system') || name.includes('system information')) {
            return 'BunnyMo System Information';
        }
        
        if (name.includes('character context') || name.includes('character information')) {
            return 'Character Context Information';
        }
        
        if (name.includes('world information') || name.includes('world context')) {
            return 'World Information Context';
        }
        
        if (name.includes('chat messages') || name.includes('chat context')) {
            return 'Chat Messages Context';
        }
        
        if (name.includes('lorebook content') || name.includes('lorebook context')) {
            return 'Lorebook Content Context';
        }
        
        if (name.includes('available tags') || name.includes('tags context')) {
            return 'Available Tags Context';
        }
        
        if (name.includes('character data injection') || name.includes('data injection')) {
            return 'Character Data Injection';
        }
        
        if (name.includes('generation notes') || name.includes('important notes')) {
            return 'Generation Important Notes';
        }
        
        if (name.includes('fullsheet') || name.includes('full sheet')) {
            return 'BunnyMo Fullsheet Format';
        }
        
        if (name.includes('quicksheet') || name.includes('quick sheet')) {
            return 'BunnyMo Quicksheet Format';
        }
        
        // Default to BunnyRecc System Prompt if no match
        return 'BunnyRecc System Prompt';
    }

    // Save settings to extension_settings
    save_settings() {
        if (!this.selectedTemplate) return;
        
        if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
        if (!extension_settings[extensionName].templates) extension_settings[extensionName].templates = {};
        
        extension_settings[extensionName].templates[this.selectedTemplate] = {
            content: this.$prompt.val(),
            type: this.$template_type.val(),
            category: this.$template_category.val(),
            primary: this.$template_role.prop('checked'),
            macros: this.get_all_macros()
        };
        
        saveSettingsDebounced();
    }

    // Macro management methods
    update_macros(macro=null) {
        if (macro === null) {
            // Clear existing macro interfaces
            this.$definitions.empty();
            
            for (let name of this.list_macros()) {
                let macro = this.get_macro(name)
                this.create_macro_interface(macro)
            }
        } else {
            this.create_macro_interface(macro)
        }
    }

    list_macros() {
        return Object.keys(this.macros);
    }

    get_macro(name) {
        let macro = this.macros[name];
        if (macro) return macro;
        return null;
    }

    detectMacrosFromTemplate() {
        // Get current template content from textarea
        const templateContent = this.$prompt.val() || '';
        
        // Detect all {{MACRO_NAME}} patterns
        const macroRegex = /\{\{([^}]+)\}\}/g;
        const detectedMacros = new Set();
        let match;
        
        // List of template syntax that should be ignored (not BunnyMo macros)
        const ignoredPatterns = [
            '/each', 'each', '#each', '/if', 'if', '#if', 
            'value', 'category', 'traits', 'name', 'content',
            'index', 'key', 'this', '@index', '@key', '@first', '@last'
        ];
        
        while ((match = macroRegex.exec(templateContent)) !== null) {
            const macroName = match[1].trim();
            
            // Skip template helpers and common Handlebars syntax
            const isTemplateHelper = ignoredPatterns.some(pattern => 
                macroName === pattern || 
                macroName.startsWith(pattern + ' ') ||
                macroName.startsWith('#' + pattern) ||
                macroName.startsWith('/' + pattern)
            );
            
            // Only add valid BunnyMo macro names (uppercase with underscores)
            if (!isTemplateHelper && /^[A-Z][A-Z_]*$/.test(macroName)) {
                detectedMacros.add(macroName);
            }
        }
        
        // Create macro objects for detected macros
        detectedMacros.forEach(name => {
            if (!this.macros[name]) {
                this.macros[name] = {
                    ...this.default_macro_settings,
                    name: name
                };
            }
        });
        
        // Only remove macros that are no longer in template AND not default macros
        const currentMacroNames = Object.keys(this.macros);
        currentMacroNames.forEach(name => {
            if (!detectedMacros.has(name) && !this.macros[name].default) {
                delete this.macros[name];
            }
        });
        
        // Detected ${detectedMacros.size} valid macros: ${Array.from(detectedMacros).join(', ')}
    }

    get_all_macros() {
        const templates = extension_settings[extensionName]?.templates || {};
        if (this.selectedTemplate && templates[this.selectedTemplate]?.macros) {
            return templates[this.selectedTemplate].macros;
        }
        return {};
    }

    create_macro_interface(macro) {
        // Create or update a macro interface item with the given settings
        let id = this.get_id(macro.name);
        let $macro = this.$definitions.find(`#${id}`);
        
        if ($macro.length === 0) {
            $macro = $(this.macro_definition_template).prependTo(this.$definitions);
            $macro.attr('id', id);
        }

        // Set up radio group name for this specific macro
        let radio_group_name = `macro_type_radio_${macro.name}`;
        $macro.find('.macro_type input[type="radio"]').attr('name', radio_group_name);
        
        // Hide Simple/Advanced toggle for macros that don't need it
        const needsBothModes = ['AVAILABLE_TAGS', 'LOREBOOK_CONTENT', 'CHAT_CONTEXT', 'SELECTED_TRAITS', 'BUNNYMO_DESCRIPTION'];
        const $typeToggle = $macro.find('.macro_type').parent();
        
        if (!needsBothModes.includes(macro.name)) {
            $typeToggle.hide();
            // Force these macros to "simple" mode since they only have one interface
            macro.type = 'simple';
        } else {
            $typeToggle.show();
        }

        // Get references to form elements
        let $name = $macro.find('input.macro_name');
        let $enable = $macro.find('button.macro_enable');
        let $preview = $macro.find('button.macro_preview');
        let $delete = $macro.find('button.macro_delete');
        let $restore = $macro.find('button.macro_restore');
        let $type_radios = $macro.find(`input[name="${radio_group_name}"]`);
        // Set values from macro object
        $name.val(macro.name);
        
        // Set radio button for macro type
        $type_radios.filter(`[value="${macro.type}"]`).prop('checked', true);
        
        // Load saved values into form fields
        this.loadMacroValues(macro, $macro);

        // Set enable/disable button state
        $enable.removeClass(TemplatePromptEditInterface.fa_enabled + ' ' + TemplatePromptEditInterface.fa_disabled);
        $enable.removeClass('button_highlight red_button');
        
        if (macro.enabled) {
            $enable.addClass(TemplatePromptEditInterface.fa_enabled + ' button_highlight');
            $enable.attr('title', 'Enabled');
        } else {
            $enable.addClass(TemplatePromptEditInterface.fa_disabled + ' red_button');
            $enable.attr('title', 'Disabled');
        }

        // Show/hide appropriate settings divs based on type
        let $simple_div = $macro.find('.macro_type_simple');
        let $advanced_div = $macro.find('.macro_type_advanced');
        
        // Populate macro-specific content and documentation
        this.populateMacroSpecificContent(macro, $macro);
        this.populateMacroDocumentation(macro, $macro);
        
        // Use CSS display instead of jQuery show/hide to avoid DOM issues
        if (macro.type === 'simple') {
            $simple_div.css('display', 'block');
            $advanced_div.css('display', 'none');
        } else {
            $simple_div.css('display', 'none');
            $advanced_div.css('display', 'block');
        }

        // Event handlers
        $name.off('change').on('change', () => {
            const oldName = macro.name;
            const newName = $name.val().trim();
            if (newName && newName !== oldName) {
                macro.name = newName;
                this.macros[newName] = macro;
                delete this.macros[oldName];
                $macro.attr('id', this.get_id(newName));
            }
        });

        $enable.off('click').on('click', () => {
            macro.enabled = !macro.enabled;
            this.create_macro_interface(macro); // Refresh to update button state
        });

        $type_radios.off('change').on('change', () => {
            macro.type = $type_radios.filter(':checked').val();
            // Update visibility without full recreation to avoid losing input values
            if (macro.type === 'simple') {
                $simple_div.css('display', 'block');
                $advanced_div.css('display', 'none');
            } else {
                $simple_div.css('display', 'none');
                $advanced_div.css('display', 'block');
            }
        });

        // Event handlers for macro-specific fields - save on change only
        $macro.find('input, select, textarea').off('change.macro').on('change.macro', () => {
            this.saveMacroValues(macro, $macro);
        });

        $preview.off('click').on('click', () => {
            this.previewMacro(macro);
        });

        $delete.off('click').on('click', () => {
            if (confirm(`Delete macro "${macro.name}"?`)) {
                delete this.macros[macro.name];
                $macro.remove();
            }
        });

        // Interface created for macro: ${macro.name}
    }
    
    populateMacroSpecificContent(macro, $macro) {
        const $simpleContent = $macro.find('.macro_simple_content');
        const $advancedContent = $macro.find('.macro_advanced_content');
        
        // Clear existing content
        $simpleContent.empty();
        $advancedContent.empty();
        
        // Generate content based on macro name
        const config = this.getMacroConfiguration(macro.name);
        const needsBothModes = ['AVAILABLE_TAGS', 'LOREBOOK_CONTENT', 'CHAT_CONTEXT', 'SELECTED_TRAITS', 'BUNNYMO_DESCRIPTION'];
        
        if (needsBothModes.includes(macro.name)) {
            // Complex macro with Simple/Advanced modes
            if (config.simple) {
                $simpleContent.html(config.simple);
            }
            if (config.advanced) {
                $advancedContent.html(config.advanced);
            }
        } else {
            // Simple macro - put content in both sections (only one will be visible)
            if (config.content) {
                $simpleContent.html(config.content);
                $advancedContent.html(config.content);
            }
        }
    }
    
    populateMacroDocumentation(macro, $macro) {
        const $docsContent = $macro.find('.bmt-macro-description');
        const documentation = this.getMacroDocumentation(macro.name);
        $docsContent.html(documentation);
    }
    
    getMacroDocumentation(macroName) {
        const docs = {
            'AVAILABLE_TAGS': `
                <div class="bmt-macro-doc-header">
                    <span class="bmt-macro-icon">🏷️</span>
                    <strong>Available Tags</strong>
                </div>
                <p>Provides a list of all BunnyMo tags that can be applied to characters. This macro dynamically generates available personality traits, appearance features, species types, and other descriptive tags from your loaded BunnyMo lorebooks.</p>
                <div class="bmt-macro-use-case">
                    <strong>Use in templates like:</strong> "Available character traits: {{AVAILABLE_TAGS}}"
                </div>
            `,
            
            'LOREBOOK_CONTENT': `
                <div class="bmt-macro-doc-header">
                    <span class="bmt-macro-icon">📚</span>
                    <strong>Lorebook Content</strong>
                </div>
                <p>Extracts and formats content from active BunnyMo lorebooks. This can include full entries, summaries, or just key names depending on your configuration. Perfect for providing context about the current world/scenario.</p>
                <div class="bmt-macro-use-case">
                    <strong>Use in templates like:</strong> "Current world info: {{LOREBOOK_CONTENT}}"
                </div>
            `,
            
            'CHAT_CONTEXT': `
                <div class="bmt-macro-doc-header">
                    <span class="bmt-macro-icon">💬</span>
                    <strong>Chat Context</strong>
                </div>
                <p>Provides recent conversation history from the current chat. You can configure which messages to include (user/assistant), how many messages, and whether to apply formatting. Useful for maintaining conversation flow in templates.</p>
                <div class="bmt-macro-use-case">
                    <strong>Use in templates like:</strong> "Recent conversation: {{CHAT_CONTEXT}}"
                </div>
            `,
            
            'WORLD_INFO': `
                <div class="bmt-macro-doc-header">
                    <span class="bmt-macro-icon">🌍</span>
                    <strong>World Information</strong>
                </div>
                <p>Retrieves world information from SillyTavern's world info system. Can provide setting descriptions, world rules, lore entries, or comprehensive world data to give your character proper context about their environment.</p>
                <div class="bmt-macro-use-case">
                    <strong>Use in templates like:</strong> "World setting: {{WORLD_INFO}}"
                </div>
            `,
            
            'CHARACTER_CONTEXT': `
                <div class="bmt-macro-doc-header">
                    <span class="bmt-macro-icon">👤</span>
                    <strong>Character Context</strong>
                </div>
                <p>Extracts specific information about the current character, such as their description, personality, scenario, or example messages. This helps templates access and utilize character-specific information.</p>
                <div class="bmt-macro-use-case">
                    <strong>Use in templates like:</strong> "Character info: {{CHARACTER_CONTEXT}}"
                </div>
            `,
            
            'BUNNYMO_DESCRIPTION': `
                <div class="bmt-macro-doc-header">
                    <span class="bmt-macro-icon">🎭</span>
                    <strong>BunnyMo Description</strong>
                </div>
                <p>Generates a formatted character description using BunnyMo's trait system. This combines selected traits into coherent narrative, bullet-point, or tag-based descriptions depending on your preferences.</p>
                <div class="bmt-macro-use-case">
                    <strong>Use in templates like:</strong> "Character description: {{BUNNYMO_DESCRIPTION}}"
                </div>
            `,
            
            'SELECTED_TRAITS': `
                <div class="bmt-macro-doc-header">
                    <span class="bmt-macro-icon">✨</span>
                    <strong>Selected Traits</strong>
                </div>
                <p>Lists the currently active/selected BunnyMo traits for the character. Can be formatted as a simple list, categorized by type, or include trait weights. Essential for trait-based character generation.</p>
                <div class="bmt-macro-use-case">
                    <strong>Use in templates like:</strong> "Active traits: {{SELECTED_TRAITS}}"
                </div>
            `,
            
            'USER_REQUEST': `
                <div class="bmt-macro-doc-header">
                    <span class="bmt-macro-icon">📝</span>
                    <strong>User Request</strong>
                </div>
                <p>Captures and processes the user's current request or recent requests. This can be the last user message, a combination of recent requests, or a summary of user intent to help guide character responses.</p>
                <div class="bmt-macro-use-case">
                    <strong>Use in templates like:</strong> "User wants: {{USER_REQUEST}}"
                </div>
            `,
            
            'PERSONALITY': `
                <div class="bmt-macro-doc-header">
                    <span class="bmt-macro-icon">🧠</span>
                    <strong>Personality</strong>
                </div>
                <p>Generates personality descriptions based on the character's traits and data. Can output key personality traits, full descriptions, or MBTI-style formatting. Automatically adapts based on available character information.</p>
                <div class="bmt-macro-use-case">
                    <strong>Use in templates like:</strong> "Personality: {{PERSONALITY}}"
                </div>
            `,
            
            'USER_NAME': `
                <div class="bmt-macro-doc-header">
                    <span class="bmt-macro-icon">👥</span>
                    <strong>User Name</strong>
                </div>
                <p>Provides the user's name in various formats. Can use the display name, system name, or a custom override. Useful for personalizing character responses and maintaining proper addressing in conversations.</p>
                <div class="bmt-macro-use-case">
                    <strong>Use in templates like:</strong> "Hello {{USER_NAME}}, how can I help?"
                </div>
            `,
            
            'CHARACTER_NAME': `
                <div class="bmt-macro-doc-header">
                    <span class="bmt-macro-icon">🎪</span>
                    <strong>Character Name</strong>
                </div>
                <p>Provides the character's name in different formats - display name, full name, or nickname variations. Essential for templates that need to reference the character by name in descriptions or responses.</p>
                <div class="bmt-macro-use-case">
                    <strong>Use in templates like:</strong> "{{CHARACTER_NAME}} responds thoughtfully..."
                </div>
            `
        };
        
        return docs[macroName] || `
            <div class="bmt-macro-doc-header">
                <span class="bmt-macro-icon">⚙️</span>
                <strong>${macroName}</strong>
            </div>
            <p>Custom macro for BunnyMo template processing. Configure the settings below to define how this macro should behave when used in templates.</p>
        `;
    }
    
    getMacroConfiguration(macroName) {
        // Define which macros actually need both Simple and Advanced modes
        const needsBothModes = ['AVAILABLE_TAGS', 'LOREBOOK_CONTENT', 'CHAT_CONTEXT', 'SELECTED_TRAITS', 'BUNNYMO_DESCRIPTION'];
        
        const configs = {
            'AVAILABLE_TAGS': {
                simple: `
                    <label class="checkbox_label">
                        <span>Tag Categories</span>
                        <select class="macro_tag_categories text_pole" multiple>
                            <option value="personality">Personality</option>
                            <option value="appearance">Appearance</option>
                            <option value="traits">Traits</option>
                            <option value="species">Species</option>
                        </select>
                    </label>
                    <label class="checkbox_label">
                        <input type="number" class="macro_tag_limit text_pole" min="1" max="50" value="10" />
                        <span>Max Tags to Show</span>
                    </label>
                `,
                advanced: `
                    <label class="checkbox_label">
                        <span>Custom Filter Script</span>
                        <textarea class="macro_command text_pole" placeholder="return tags.filter(tag => tag.category === 'personality');" rows="3"></textarea>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" class="macro_format_json" />
                        <span>Format as JSON</span>
                    </label>
                `
            },
            
            'LOREBOOK_CONTENT': {
                simple: `
                    <label class="checkbox_label">
                        <span>Content Type</span>
                        <select class="macro_content_type text_pole">
                            <option value="full">Full Entries</option>
                            <option value="summary">Summaries Only</option>
                            <option value="keys">Key Names Only</option>
                        </select>
                    </label>
                    <label class="checkbox_label">
                        <input type="number" class="macro_entry_limit text_pole" min="1" max="100" value="20" />
                        <span>Max Entries</span>
                    </label>
                `,
                advanced: `
                    <label class="checkbox_label">
                        <span>Entry Filter Script</span>
                        <textarea class="macro_command text_pole" placeholder="return entries.filter(e => e.priority > 5);" rows="3"></textarea>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" class="macro_include_disabled" />
                        <span>Include Disabled Entries</span>
                    </label>
                `
            },
            
            'CHAT_CONTEXT': {
                simple: `
                    <label class="checkbox_label">
                        <span>Message Range</span>
                        <div class="flex-container">
                            <input type="number" class="macro_msg_start text_pole" min="1" value="1" placeholder="Start" />
                            <span> to </span>
                            <input type="number" class="macro_msg_end text_pole" min="1" value="10" placeholder="End" />
                        </div>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" class="macro_include_user" checked />
                        <span>Include User Messages</span>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" class="macro_include_assistant" checked />
                        <span>Include Assistant Messages</span>
                    </label>
                `,
                advanced: `
                    <label class="checkbox_label">
                        <span>Message Filter Script</span>
                        <textarea class="macro_command text_pole" placeholder="return messages.filter(m => m.content.length > 50);" rows="3"></textarea>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" class="macro_strip_formatting" />
                        <span>Strip HTML/Markdown</span>
                    </label>
                `
            },
            
            'WORLD_INFO': {
                content: `
                    <label class="checkbox_label">
                        <span>Info Type</span>
                        <select class="macro_world_type text_pole">
                            <option value="setting">Setting Description</option>
                            <option value="rules">World Rules</option>
                            <option value="lore">Lore Entries</option>
                            <option value="all">All World Info</option>
                        </select>
                    </label>
                `
            },
            
            'CHARACTER_CONTEXT': {
                content: `
                    <label class="checkbox_label">
                        <span>Context Type</span>
                        <select class="macro_char_context text_pole">
                            <option value="description">Character Description</option>
                            <option value="personality">Personality</option>
                            <option value="scenario">Scenario</option>
                            <option value="examples">Example Messages</option>
                        </select>
                    </label>
                `
            },
            
            'BUNNYMO_DESCRIPTION': {
                simple: `
                    <label class="checkbox_label">
                        <span>Description Format</span>
                        <select class="macro_desc_format text_pole">
                            <option value="narrative">Narrative Style</option>
                            <option value="bullet">Bullet Points</option>
                            <option value="tags">Tag Format</option>
                        </select>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" class="macro_include_physical" checked />
                        <span>Include Physical Traits</span>
                    </label>
                `,
                advanced: `
                    <label class="checkbox_label">
                        <span>Description Builder Script</span>
                        <textarea class="macro_command text_pole" placeholder="return traits.filter(t => t.category === 'appearance').map(t => t.value).join(', ');" rows="4"></textarea>
                    </label>
                `
            },
            
            'SELECTED_TRAITS': {
                simple: `
                    <label class="checkbox_label">
                        <span>Trait Format</span>
                        <select class="macro_trait_format text_pole">
                            <option value="list">Simple List</option>
                            <option value="categorized">By Category</option>
                            <option value="weighted">With Weights</option>
                        </select>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" class="macro_active_only" checked />
                        <span>Active Traits Only</span>
                    </label>
                `,
                advanced: `
                    <label class="checkbox_label">
                        <span>Trait Processing Script</span>
                        <textarea class="macro_command text_pole" placeholder="return traits.sort((a,b) => b.weight - a.weight).slice(0, 10);" rows="3"></textarea>
                    </label>
                `
            },
            
            'USER_REQUEST': {
                content: `
                    <label class="checkbox_label">
                        <span>Request Source</span>
                        <select class="macro_request_source text_pole">
                            <option value="last">Last User Message</option>
                            <option value="combined">All Recent Requests</option>
                            <option value="summary">Request Summary</option>
                        </select>
                    </label>
                `
            },
            
            'PERSONALITY': {
                content: `
                    <label class="checkbox_label">
                        <span>Personality Style</span>
                        <select class="macro_personality_style text_pole">
                            <option value="traits">Key Traits</option>
                            <option value="description">Full Description</option>
                            <option value="mbti">MBTI Format</option>
                        </select>
                    </label>
                `
            },
            
            'USER_NAME': {
                content: `
                    <label class="checkbox_label">
                        <span>Name Format</span>
                        <select class="macro_name_format text_pole">
                            <option value="display">Display Name</option>
                            <option value="system">System Name</option>
                            <option value="custom">Custom Override</option>
                        </select>
                    </label>
                    <div class="macro_custom_name" style="display: none;">
                        <input type="text" class="macro_name_override text_pole" placeholder="Custom name..." />
                    </div>
                `
            },
            
            'CHARACTER_NAME': {
                content: `
                    <label class="checkbox_label">
                        <span>Name Format</span>
                        <select class="macro_char_name_format text_pole">
                            <option value="display">Display Name</option>
                            <option value="full">Full Name</option>
                            <option value="nickname">Nickname/Pet Name</option>
                        </select>
                    </label>
                `
            }
        };
        
        return configs[macroName] || {
            content: `<input type="text" class="macro_preset_value text_pole" placeholder="Configure macro..." />`
        };
    }
    
    saveMacroValues(macro, $macro) {
        // Save all form values within this macro to the macro object
        $macro.find('input, select, textarea').each((i, element) => {
            const $el = $(element);
            const className = element.className;
            const value = $el.is(':checkbox') ? $el.is(':checked') : $el.val();
            
            // Map form fields to macro properties based on CSS classes
            if (className.includes('macro_tag_categories')) macro.tagCategories = value;
            else if (className.includes('macro_tag_limit')) macro.tagLimit = value;
            else if (className.includes('macro_content_type')) macro.contentType = value;
            else if (className.includes('macro_entry_limit')) macro.entryLimit = value;
            else if (className.includes('macro_msg_start')) macro.msgStart = value;
            else if (className.includes('macro_msg_end')) macro.msgEnd = value;
            else if (className.includes('macro_include_user')) macro.includeUser = value;
            else if (className.includes('macro_include_assistant')) macro.includeAssistant = value;
            else if (className.includes('macro_world_type')) macro.worldType = value;
            else if (className.includes('macro_char_context')) macro.charContext = value;
            else if (className.includes('macro_desc_format')) macro.descFormat = value;
            else if (className.includes('macro_include_physical')) macro.includePhysical = value;
            else if (className.includes('macro_trait_format')) macro.traitFormat = value;
            else if (className.includes('macro_active_only')) macro.activeOnly = value;
            else if (className.includes('macro_request_source')) macro.requestSource = value;
            else if (className.includes('macro_personality_style')) macro.personalityStyle = value;
            else if (className.includes('macro_name_format')) macro.nameFormat = value;
            else if (className.includes('macro_name_override')) macro.nameOverride = value;
            else if (className.includes('macro_char_name_format')) macro.charNameFormat = value;
            else if (className.includes('macro_command')) macro.command = value;
            else if (className.includes('macro_format_json')) macro.formatJson = value;
            else if (className.includes('macro_include_disabled')) macro.includeDisabled = value;
            else if (className.includes('macro_strip_formatting')) macro.stripFormatting = value;
            // Add other field mappings as needed
        });
        
        // Values saved for macro: ${macro.name}
    }
    
    loadMacroValues(macro, $macro) {
        // Load saved values back into form fields
        $macro.find('input, select, textarea').each((i, element) => {
            const $el = $(element);
            const className = element.className;
            let value = null;
            
            // Map macro properties back to form fields based on CSS classes
            if (className.includes('macro_tag_categories')) value = macro.tagCategories;
            else if (className.includes('macro_tag_limit')) value = macro.tagLimit || 10;
            else if (className.includes('macro_content_type')) value = macro.contentType || 'full';
            else if (className.includes('macro_entry_limit')) value = macro.entryLimit || 20;
            else if (className.includes('macro_msg_start')) value = macro.msgStart || 1;
            else if (className.includes('macro_msg_end')) value = macro.msgEnd || 10;
            else if (className.includes('macro_include_user')) value = macro.includeUser !== false;
            else if (className.includes('macro_include_assistant')) value = macro.includeAssistant !== false;
            else if (className.includes('macro_world_type')) value = macro.worldType || 'setting';
            else if (className.includes('macro_char_context')) value = macro.charContext || 'description';
            else if (className.includes('macro_desc_format')) value = macro.descFormat || 'narrative';
            else if (className.includes('macro_include_physical')) value = macro.includePhysical !== false;
            else if (className.includes('macro_trait_format')) value = macro.traitFormat || 'list';
            else if (className.includes('macro_active_only')) value = macro.activeOnly !== false;
            else if (className.includes('macro_request_source')) value = macro.requestSource || 'last';
            else if (className.includes('macro_personality_style')) value = macro.personalityStyle || 'traits';
            else if (className.includes('macro_name_format')) value = macro.nameFormat || 'display';
            else if (className.includes('macro_name_override')) value = macro.nameOverride || '';
            else if (className.includes('macro_char_name_format')) value = macro.charNameFormat || 'display';
            else if (className.includes('macro_command')) value = macro.command || '';
            else if (className.includes('macro_format_json')) value = macro.formatJson || false;
            else if (className.includes('macro_include_disabled')) value = macro.includeDisabled || false;
            else if (className.includes('macro_strip_formatting')) value = macro.stripFormatting || false;
            
            // Set the form field value if we found a matching property
            if (value !== null) {
                if ($el.is(':checkbox')) {
                    $el.prop('checked', value);
                } else {
                    $el.val(value);
                }
            }
        });
        
        // Handle special cases like custom name field visibility
        const nameFormatSelect = $macro.find('.macro_name_format');
        const customNameDiv = $macro.find('.macro_custom_name');
        if (nameFormatSelect.val() === 'custom') {
            customNameDiv.show();
        } else {
            customNameDiv.hide();
        }
        
        // Add event listener for name format change
        nameFormatSelect.off('change.custom').on('change.custom', function() {
            if ($(this).val() === 'custom') {
                customNameDiv.show();
            } else {
                customNameDiv.hide();
            }
        });
    }
    
    previewMacro(macro) {
        let previewContent = '';
        
        if (macro.type === 'simple') {
            // Generate meaningful preview based on macro configuration
            switch (macro.name) {
                case 'AVAILABLE_TAGS':
                    previewContent = `Categories: ${macro.tagCategories || 'All'}<br>Max Tags: ${macro.tagLimit || 10}`;
                    break;
                case 'SELECTED_TRAITS':
                    previewContent = `Format: ${macro.traitFormat || 'Simple List'}<br>Active Only: ${macro.activeOnly !== false ? 'Yes' : 'No'}`;
                    break;
                case 'PERSONALITY':
                    previewContent = `Style: ${macro.personalityStyle || 'Key Traits'}`;
                    break;
                case 'CHARACTER_NAME':
                    previewContent = `Format: ${macro.charNameFormat || 'Display Name'}`;
                    break;
                case 'USER_NAME':
                    previewContent = `Format: ${macro.nameFormat || 'Display Name'}`;
                    if (macro.nameFormat === 'custom' && macro.nameOverride) {
                        previewContent += `<br>Custom: ${macro.nameOverride}`;
                    }
                    break;
                case 'LOREBOOK_CONTENT':
                    previewContent = `Type: ${macro.contentType || 'Full Entries'}<br>Max: ${macro.entryLimit || 20} entries`;
                    break;
                case 'CHAT_CONTEXT':
                    previewContent = `Messages: ${macro.msgStart || 1} to ${macro.msgEnd || 10}<br>Include User: ${macro.includeUser !== false ? 'Yes' : 'No'}<br>Include Assistant: ${macro.includeAssistant !== false ? 'Yes' : 'No'}`;
                    break;
                default:
                    previewContent = 'Simple mode - configured settings will be applied';
            }
        } else {
            // Advanced mode - show the script
            previewContent = `<strong>Script:</strong><br><pre>${macro.command || '[No script defined]'}</pre>`;
        }
        
        this.ctx.Popup.alert('Macro Preview', `<strong>${macro.name} (${macro.type})</strong><br><br>${previewContent}`);
    }

    new_macro() {
        const newMacro = {...this.default_macro_settings, name: `macro_${Date.now()}`};
        this.macros[newMacro.name] = newMacro;
        this.create_macro_interface(newMacro);
    }

    get_id(name) {
        return `macro_${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }

    preview_prompt() {
        const content = this.$prompt.val() || 'No content';
        alert('Template Preview:\n\n' + content);
    }

    duplicate_template() {
        if (!this.selectedTemplate) return;
        
        const customName = prompt('Enter a name for your custom template:', this.selectedTemplate + ' (Custom)');
        if (!customName) return;
        
        // Create a new template entry
        if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
        if (!extension_settings[extensionName].templates) extension_settings[extensionName].templates = {};
        
        // Copy current template data
        extension_settings[extensionName].templates[customName] = {
            content: this.$prompt.val(),
            type: this.$template_type.val(),
            category: this.$template_category.val(),
            primary: false, // Don't auto-mark as primary
            macros: this.get_all_macros(),
            custom: true
        };
        
        saveSettingsDebounced();
        
        // Update dropdown and select the new template
        this.populateTemplateSelector();
        this.$template_selector.val(customName);
        this.selectedTemplate = customName;
        this.from_settings();
        
        alert(`Template "${customName}" created successfully! You can now customize it and mark it as primary.`);
    }
    
    save_template() {
        if (!this.selectedTemplate) {
            alert('No template selected to save.');
            return;
        }
        
        this.save_settings();
        alert(`Template "${this.selectedTemplate}" saved successfully!`);
    }
    
    delete_template() {
        if (!this.selectedTemplate) {
            alert('No template selected to delete.');
            return;
        }
        
        // Check if it's a custom template
        const isCustom = extension_settings[extensionName]?.templates?.[this.selectedTemplate]?.custom;
        if (!isCustom) {
            alert('Cannot delete default templates. Only custom templates can be deleted.');
            return;
        }
        
        if (!confirm(`Delete template "${this.selectedTemplate}"? This action cannot be undone.`)) {
            return;
        }
        
        // Remove from extension_settings
        if (extension_settings[extensionName]?.templates) {
            delete extension_settings[extensionName].templates[this.selectedTemplate];
            saveSettingsDebounced();
        }
        
        // Update dropdown and select first available template
        this.populateTemplateSelector();
        const firstOption = this.$template_selector.find('option[value!=""]').first().val();
        if (firstOption) {
            this.$template_selector.val(firstOption);
            this.selectedTemplate = firstOption;
            this.from_settings();
        } else {
            this.selectedTemplate = null;
            this.$prompt.val('');
        }
        
        alert(`Template "${this.selectedTemplate || 'deleted'}" has been deleted.`);
    }
    
    restore_default() {
        if (this.selectedTemplate && confirm('Restore default template? This will overwrite your changes.')) {
            // Restore logic here
            this.$prompt.val('Default template content...');
        }
    }
}

// Global variables
let templatePromptEditInterface = null;
