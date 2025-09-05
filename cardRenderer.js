/**
 * @file Card-based UI renderer for BunnyMoTags character tag data - Horizontal Layout
 * Displays character tags in beautiful horizontal cards with smart grouping
 */

import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'BunnyMoTags-CardRenderer';
const extensionName = 'BunnyMoTags';

// Parse BunnyMoTags data from injection blocks (original tag-based format)
export const parseBunnyMoData = (content) => {
    try {
        // Handle JSON format if provided
        if (content.trim().startsWith('{')) {
            const parsed = JSON.parse(content);
            
            // Check if this is sanitized data (contains placeholders like [Character_1])
            if (parsed.characters && parsed.characters.some(char => 
                char.name && char.name.startsWith('[Character_') && char.displayName)) {
                
                // Desanitize the data - restore original names and sources
                return {
                    ...parsed,
                    characters: parsed.characters.map(char => ({
                        ...char,
                        name: char.displayName || char.name, // Restore original name
                        source: char.originalSource || char.source // Restore original source
                        // Keep displayName and originalSource for reference if needed
                    }))
                };
            }
            
            return parsed;
        }
        
        // Parse the original BunnyMoTags text format for character tags
        const lines = content.split('\n').filter(line => line.trim());
        const data = { characters: [] };
        let currentCharacter = null;
        
        lines.forEach(line => {
            const trimmed = line.trim();
            
            // Look for character name patterns
            if (trimmed.includes(':') && !trimmed.startsWith('-')) {
                // This might be a character name line
                const [possibleName, possibleTags] = trimmed.split(':', 2);
                if (possibleName && !possibleName.toLowerCase().includes('tag')) {
                    // Start new character
                    if (currentCharacter) {
                        data.characters.push(currentCharacter);
                    }
                    currentCharacter = {
                        name: possibleName.trim(),
                        tags: {},
                        source: 'BunnyMoTags'
                    };
                    
                    // Process any tags on the same line
                    if (possibleTags) {
                        processTagLine(possibleTags.trim(), currentCharacter, 'other');
                    }
                }
            } else if (currentCharacter && trimmed.startsWith('-') && trimmed.includes(':')) {
                // This is a tag category line: "- Category: tag1, tag2, tag3"
                const tagContent = trimmed.substring(1).trim(); // Remove the "-"
                const [category, tagsStr] = tagContent.split(':', 2);
                if (category && tagsStr) {
                    const cleanCategory = category.trim().toLowerCase();
                    processTagLine(tagsStr.trim(), currentCharacter, cleanCategory);
                }
            } else if (currentCharacter && trimmed.startsWith('-')) {
                // Simple tag line: "- tag"
                const tag = trimmed.substring(1).trim();
                if (tag) {
                    if (!currentCharacter.tags.other) {
                        currentCharacter.tags.other = [];
                    }
                    currentCharacter.tags.other.push(tag);
                }
            } else if (currentCharacter && trimmed) {
                // Try to parse as a category line or add to other
                if (trimmed.includes(':')) {
                    const [category, tagsStr] = trimmed.split(':', 2);
                    const cleanCategory = category.trim().toLowerCase();
                    processTagLine(tagsStr.trim(), currentCharacter, cleanCategory);
                }
            }
        });
        
        if (currentCharacter) {
            data.characters.push(currentCharacter);
        }
        
        return data;
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Failed to parse BunnyMo data:`, error);
        return null;
    }
};

// Helper function to process tag lines
function processTagLine(tagsStr, character, category) {
    if (!tagsStr) return;
    
    const tags = tagsStr.split(',')
        .map(tag => tag.trim())
        .filter(tag => tag);
    
    if (tags.length > 0) {
        if (!character.tags[category]) {
            character.tags[category] = [];
        }
        character.tags[category].push(...tags);
    }
}

// Generate BunnyMo context block for AI injection
export const generateBunnyMoBlock = (data) => {
    // Handle both direct characters array and data object with characters property
    const characters = Array.isArray(data) ? data : data?.characters || [];
    
    if (!characters || characters.length === 0) return '';
    
    let output = '[CHARACTER CONTEXT - BunnyMo Tags]\n\n';
    
    characters.forEach(character => {
        output += `${character.name}:\n`;
        
        Object.entries(character.tags || {}).forEach(([category, tags]) => {
            if (tags && tags.length > 0) {
                output += `  - ${category}: ${tags.join(', ')}\n`;
            }
        });
        output += '\n';
    });
    
    return output.trim();
};

// Get default tag group mapping (customizable by user)
const getTagGroupMapping = () => {
    // Users can override this in extension settings
    const settings = extension_settings.BunnyMoTags || {};
    return settings.tagGroups || {
        personality: ['personality', 'traits', 'behavior', 'mental', 'attitude', 'mind'],
        body: ['physical', 'appearance', 'body', 'species', 'gender', 'age', 'looks'],
        kinks: ['kinks', 'fetish', 'sexual', 'nsfw', 'adult', 'erotic'],
        // Everything else goes to 'others' automatically
    };
};

// Smart tag grouping system
const groupTags = (tags) => {
    const groupMapping = getTagGroupMapping();
    const groups = {
        personality: [],
        body: [],
        kinks: [],
        others: []
    };
    
    Object.entries(tags).forEach(([category, tagList]) => {
        if (!Array.isArray(tagList) || tagList.length === 0) return;
        
        const categoryLower = category.toLowerCase();
        let foundGroup = 'others'; // default
        
        // Check which group this category belongs to
        for (const [groupName, keywords] of Object.entries(groupMapping)) {
            if (keywords.some(keyword => categoryLower.includes(keyword))) {
                foundGroup = groupName;
                break;
            }
        }
        
        groups[foundGroup].push({
            category: category,
            tags: tagList,
            originalCategory: category
        });
    });
    
    return groups;
};

// Create group sections (Personality, Body, Kinks, Others)
const createGroupSections = (groupedTags) => {
    const groupConfig = {
        personality: { icon: '💭', title: 'Personality', color: '#f39c12' },
        body: { icon: '👁️', title: 'Body & Appearance', color: '#e74c3c' },
        kinks: { icon: '🔥', title: 'Kinks & Preferences', color: '#9b59b6' },
        others: { icon: '📦', title: 'Other Categories', color: '#95a5a6', collapsible: true }
    };
    
    let sectionsHTML = '';
    
    Object.entries(groupConfig).forEach(([groupName, config]) => {
        const groupData = groupedTags[groupName];
        if (!groupData || groupData.length === 0) return;
        
        const totalTagsInGroup = groupData.reduce((sum, item) => sum + item.tags.length, 0);
        const isCollapsible = config.collapsible;
        
        if (isCollapsible) {
            // Others section is collapsible
            sectionsHTML += `
                <div class="bmt-group-section collapsible">
                    <details class="bmt-group-details">
                        <summary class="bmt-group-header">
                            <span class="bmt-group-icon">${config.icon}</span>
                            <span class="bmt-group-title">${config.title}</span>
                            <span class="bmt-group-count">${totalTagsInGroup} tags</span>
                            <span class="bmt-expand-arrow">▼</span>
                        </summary>
                        <div class="bmt-group-content">
                            ${createGroupContent(groupData, config.color)}
                        </div>
                    </details>
                </div>
            `;
        } else {
            // Main sections always visible
            sectionsHTML += `
                <div class="bmt-group-section">
                    <div class="bmt-group-header">
                        <span class="bmt-group-icon">${config.icon}</span>
                        <span class="bmt-group-title">${config.title}</span>
                        <span class="bmt-group-count">${totalTagsInGroup} tags</span>
                    </div>
                    <div class="bmt-group-content">
                        ${createGroupContent(groupData, config.color)}
                    </div>
                </div>
            `;
        }
    });
    
    return sectionsHTML;
};

// Create content for each group
const createGroupContent = (groupData, baseColor) => {
    return groupData.map(item => `
        <div class="bmt-category-row">
            <div class="bmt-category-label">${item.category.toUpperCase()}</div>
            <div class="bmt-tags-row">
                ${item.tags.map(tag => `
                    <span class="bmt-tag-horizontal" style="background-color: ${baseColor}20; border-color: ${baseColor}; color: ${baseColor};">
                        ${tag}
                    </span>
                `).join('')}
            </div>
        </div>
    `).join('');
};

// Generate unique colors for each character
const generateCharacterColors = (name) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        const char = name.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    
    const hue = Math.abs(hash) % 360;
    const saturation = 45 + (Math.abs(hash) % 30); // 45-75%
    const lightness = 25 + (Math.abs(hash) % 20);  // 25-45%
    
    return {
        bgColor: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
        darkerBgColor: `hsl(${hue}, ${saturation}%, ${lightness - 8}%)`
    };
};

// Create horizontal character card with grouped sections
const createCharacterCard = (character, index) => {
    const { name, tags, source } = character;
    const colors = generateCharacterColors(name);
    const currentTime = new Date().toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
    });
    
    // Calculate total tag count
    let totalTags = 0;
    Object.values(tags).forEach(tagList => {
        if (Array.isArray(tagList)) totalTags += tagList.length;
    });
    
    // Create unique ID for this card
    const cardId = `bmt-card-${name.replace(/[^a-zA-Z0-9]/g, '-')}-${index}`;
    
    // Group tags intelligently
    const groupedTags = groupTags(tags);
    
    // Create group sections
    const groupSectionsHTML = createGroupSections(groupedTags);
    
    return `
        <div class="bmt-tracker-card horizontal-layout" id="${cardId}" style="background: linear-gradient(135deg, ${colors.bgColor} 0%, ${colors.darkerBgColor} 100%);" data-character="${name}">
            <div class="bmt-gradient-overlay"></div>
            
            <div class="bmt-card-header-horizontal">
                <div class="bmt-character-info">
                    <div class="bmt-character-name">${name}</div>
                    <div class="bmt-character-meta">
                        <span class="bmt-meta-badge">📖 ${source || 'BunnyMoTags'}</span>
                        <span class="bmt-meta-badge">🏷️ ${totalTags} tags</span>
                        <span class="bmt-meta-badge">⏰ ${currentTime}</span>
                    </div>
                </div>
                <div class="bmt-card-controls">
                    <button class="bmt-card-toggle" data-card-id="${cardId}" title="Collapse/Expand">
                        <span class="bmt-toggle-icon">▼</span>
                    </button>
                </div>
            </div>
            
            <div class="bmt-card-content">
                <div class="bmt-groups-container">
                    ${groupSectionsHTML}
                </div>
            </div>
        </div>
    `;
};

const createCardContainer = (data) => {
    if (!data || !data.characters || data.characters.length === 0) {
        return '';
    }
    
    // Load CSS styles first
    loadCardStyles();
    
    const cardsHTML = data.characters
        .map((character, index) => createCharacterCard(character, index))
        .join('');
    
    // Add a header for the system message with character count
    const characterCount = data.characters.length;
    const headerText = `Character Information (${characterCount} ${characterCount === 1 ? 'character' : 'characters'})`;
    
    const containerHTML = `
        <div class="bmt-system-message-header">
            <h3 style="margin: 0 0 15px 0; color: var(--SmartThemeBodyColor); font-size: 16px; font-weight: 600;">
                🏷️ ${headerText}
            </h3>
        </div>
        <div class="bmt-cards-grid horizontal">
            ${cardsHTML}
        </div>
    `;
    
    // Initialize card interactivity after a short delay to ensure DOM is ready
    setTimeout(() => {
        if (window.BMT_initializeCards) {
            window.BMT_initializeCards();
        }
    }, 100);
    
    return containerHTML;
};

// Load CSS styles from external file
const loadCardStyles = () => {
    if (document.getElementById('bmt-card-styles')) return;
    
    const link = document.createElement('link');
    link.id = 'bmt-card-styles';
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = '/scripts/extensions/third-party/BunnyMoTags/style.css';
    document.head.appendChild(link);
};

// Render BunnyMo cards in a specific message (legacy function for compatibility)
export const renderBunnyMoCards = (messageId, data) => {
    if (!data || !data.characters || data.characters.length === 0) return;
    
    console.log(`[${MODULE_NAME}] Rendering tag cards for message ${messageId}:`, data);
    
    // Find the message element
    const messageElement = document.querySelector(`div[mesid="${messageId}"] .mes_text`);
    if (!messageElement) {
        console.warn(`[${MODULE_NAME}] Could not find message element for ID ${messageId}`);
        return;
    }
    
    // Remove existing BunnyMo cards from this message
    const existingCards = messageElement.querySelectorAll('.bmt-cards-container');
    existingCards.forEach(card => card.remove());
    
    // Load CSS styles
    loadCardStyles();
    
    // Create and insert cards
    const containerHTML = createCardContainer(data);
    const container = document.createElement('div');
    container.innerHTML = containerHTML;
    const cardElement = container.firstElementChild;
    
    if (cardElement) {
        // Get position setting
        const settings = extension_settings[extensionName] || {};
        const position = settings.cardPosition || 'BOTTOM';
        
        switch (position) {
            case 'ABOVE':
                messageElement.insertAdjacentElement('afterbegin', cardElement);
                break;
            case 'BOTTOM':
            default:
                messageElement.insertAdjacentElement('beforeend', cardElement);
                break;
        }
        
        console.log(`[${MODULE_NAME}] Successfully rendered ${data.characters.length} character tag card(s) for message ${messageId}`);
    }
};

// Initialize card interactivity when cards are loaded
window.BMT_initializeCards = function() {
    const cards = document.querySelectorAll('.bmt-tracker-card');
    cards.forEach(card => {
        // Remove existing listeners to avoid duplicates
        card.removeEventListener('mouseenter', window.BMT_cardHoverIn);
        card.removeEventListener('mouseleave', window.BMT_cardHoverOut);
        card.removeEventListener('click', window.BMT_cardClick);
        
        // Add enhanced hover effects
        card.addEventListener('mouseenter', window.BMT_cardHoverIn);
        card.addEventListener('mouseleave', window.BMT_cardHoverOut);
        card.addEventListener('click', window.BMT_cardClick);
    });
    
    // Add toggle button listeners
    const toggleButtons = document.querySelectorAll('.bmt-card-toggle');
    toggleButtons.forEach(button => {
        button.removeEventListener('click', window.BMT_toggleButtonClick);
        button.addEventListener('click', window.BMT_toggleButtonClick);
    });
};

// Event handler functions
window.BMT_cardHoverIn = function() {
    this.style.transform = 'translateY(-4px) scale(1.02)';
    this.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.15)';
};

window.BMT_cardHoverOut = function() {
    this.style.transform = 'translateY(0) scale(1)';
    this.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.2), 0 1px 4px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.05)';
};

window.BMT_cardClick = function(e) {
    // Don't trigger if clicking the toggle button itself
    if (e.target.closest('.bmt-card-toggle')) return;
    
    const cardId = this.id;
    if (cardId) window.BMT_toggleCard(cardId);
};

window.BMT_toggleButtonClick = function(e) {
    e.stopPropagation();
    const cardId = this.getAttribute('data-card-id');
    if (cardId) window.BMT_toggleCard(cardId);
};

// Card toggle functionality
window.BMT_toggleCard = function(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;
    
    const content = card.querySelector('.bmt-card-content');
    const toggleIcon = card.querySelector('.bmt-toggle-icon');
    
    if (!content || !toggleIcon) return;
    
    const isCollapsed = card.classList.contains('collapsed');
    
    if (isCollapsed) {
        // Expand
        card.classList.remove('collapsed');
        toggleIcon.textContent = '▼';
        content.style.maxHeight = 'none';
        content.style.opacity = '1';
        content.style.transform = 'translateY(0)';
    } else {
        // Collapse
        card.classList.add('collapsed');
        toggleIcon.textContent = '▶';
        content.style.maxHeight = '0';
        content.style.opacity = '0';
        content.style.transform = 'translateY(-10px)';
    }
};

// Export functions
export {
    createCharacterCard,
    createCardContainer,
    generateCharacterColors
};