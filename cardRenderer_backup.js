/**
 * @file Card-based UI renderer for BunnyMoTags character tag data
 * Displays character tags in beautiful cards with proper persistence
 */

import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'BunnyMoTags-CardRenderer';
const extensionName = 'BunnyMoTags';

// Parse BunnyMoTags data from injection blocks (original tag-based format)
export const parseBunnyMoData = (content) => {
    try {
        // Handle JSON format if provided
        if (content.trim().startsWith('{')) {
            return JSON.parse(content);
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

// Generate character colors based on name hash for visual variety
const generateCharacterColors = (name) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash + name.charCodeAt(i)) & 0xffffffff;
    }
    
    const hue = Math.abs(hash) % 360;
    const saturation = 45 + (Math.abs(hash >> 8) % 30);
    const lightness = 30 + (Math.abs(hash >> 16) % 20);
    
    return {
        bgColor: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
        darkerBgColor: `hsl(${hue}, ${saturation}%, ${lightness - 8}%)`
    };
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

// Create horizontal character card with grouped sections
const createCharacterCard = (character, index) => {
    const { name, tags, source } = character;
    const colors = generateCharacterColors(name);
    const currentDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
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
    
    // Create tag sections for each category
    const tagCategories = {
        species: { color: '#ff6b6b', icon: '🧬', title: 'SPECIES' },
        gender: { color: '#4ecdc4', icon: '⚧️', title: 'GENDER' },
        genre: { color: '#45b7d1', icon: '🎭', title: 'GENRE' },
        personality: { color: '#f39c12', icon: '💭', title: 'PERSONALITY' },
        traits: { color: '#9b59b6', icon: '⭐', title: 'TRAITS' },
        physical: { color: '#e74c3c', icon: '👁️', title: 'PHYSICAL' },
        other: { color: '#95a5a6', icon: '🏷️', title: 'OTHER' }
    };
    
    let tagSectionsHTML = '';
    
    Object.entries(tags).forEach(([category, tagList]) => {
        if (!Array.isArray(tagList) || tagList.length === 0) return;
        
        const categoryKey = category.toLowerCase();
        const categoryInfo = tagCategories[categoryKey] || tagCategories.other;
        
        tagSectionsHTML += `
            <div class="bmt-tag-section">
                <div class="bmt-tag-header">
                    <span class="bmt-tag-icon">${categoryInfo.icon}</span>
                    <span class="bmt-tag-title">${categoryInfo.title}</span>
                    <span class="bmt-tag-count">${tagList.length}</span>
                </div>
                <div class="bmt-tag-list">
                    ${tagList.map(tag => `
                        <span class="bmt-tag" style="background-color: ${categoryInfo.color}20; border-color: ${categoryInfo.color}; color: ${categoryInfo.color};">
                            ${tag}
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    });
    
    return `
        <div class="bmt-tracker-card" id="${cardId}" style="background: linear-gradient(145deg, ${colors.bgColor} 0%, ${colors.darkerBgColor} 50%, ${colors.darkerBgColor} 100%);" data-character="${name}">
            <div class="bmt-gradient-overlay"></div>
            <div class="bmt-card-header">
                <div class="bmt-header-row-top">
                    <div class="bmt-header-badge">${currentTime}</div>
                    <div class="bmt-header-badge">${totalTags} tags</div>
                </div>
                <div class="bmt-header-row-middle">
                    <div class="bmt-character-name">${name}</div>
                    <div class="bmt-icon-container">
                        <button class="bmt-card-toggle" data-card-id="${cardId}" title="Collapse/Expand">
                            <span class="bmt-toggle-icon">▼</span>
                        </button>
                    </div>
                </div>
                <div class="bmt-header-row-bottom">
                    <div class="bmt-character-source">
                        <span style="margin-right: 6px; opacity: 0.7;">📖</span>
                        ${source || 'BunnyMoTags'}
                    </div>
                </div>
            </div>
            <div class="bmt-card-content">
                <div class="bmt-tags-container">
                    ${tagSectionsHTML}
                </div>
        </div>
    `;
};

// Create container for all character tag cards - system message version
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
        <div class="bmt-cards-grid">
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

// Main render function - attaches cards to specific message
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
        
        // Cards are now static like SimTracker - no interactive functionality needed
        
        console.log(`[${MODULE_NAME}] Successfully rendered ${data.characters.length} character tag card(s) for message ${messageId}`);
    }
};

// No interactive functionality needed - cards are static like SimTracker

// Generate BunnyMo block for injection (maintain compatibility)
export const generateBunnyMoBlock = (data) => {
    // Handle both direct characters array and data object with characters property
    const characters = Array.isArray(data) ? data : (data && data.characters ? data.characters : []);
    
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

// Global toggle function for card collapsing
window.BMT_toggleCard = function(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;
    
    const content = card.querySelector('.bmt-card-content');
    const toggleIcon = card.querySelector('.bmt-toggle-icon');
    
    if (!content || !toggleIcon) return;
    
    // Toggle collapsed class with smooth animation
    card.classList.toggle('collapsed');
    
    if (card.classList.contains('collapsed')) {
        content.style.maxHeight = '0';
        content.style.padding = '0 20px';
        content.style.opacity = '0';
        toggleIcon.textContent = '▶';
        toggleIcon.style.transform = 'rotate(-90deg)';
    } else {
        content.style.maxHeight = content.scrollHeight + 'px';
        content.style.padding = '0 20px 20px 20px';
        content.style.opacity = '1';
        toggleIcon.textContent = '▼';
        toggleIcon.style.transform = 'rotate(0deg)';
        
        // After animation completes, remove maxHeight to allow natural sizing
        setTimeout(() => {
            if (!card.classList.contains('collapsed')) {
                content.style.maxHeight = 'none';
            }
        }, 300);
    }
};

// Initialize card interactivity when cards are loaded
window.BMT_initializeCards = function() {
    const cards = document.querySelectorAll('.bmt-tracker-card');
    cards.forEach(card => {
        // Remove existing listeners to avoid duplicates
        card.removeEventListener('mouseenter', BMT_cardHoverIn);
        card.removeEventListener('mouseleave', BMT_cardHoverOut);
        card.removeEventListener('click', BMT_cardClick);
        
        // Add enhanced hover effects
        card.addEventListener('mouseenter', BMT_cardHoverIn);
        card.addEventListener('mouseleave', BMT_cardHoverOut);
        card.addEventListener('click', BMT_cardClick);
    });
    
    // Add toggle button listeners
    const toggleButtons = document.querySelectorAll('.bmt-card-toggle');
    toggleButtons.forEach(button => {
        button.removeEventListener('click', BMT_toggleButtonClick);
        button.addEventListener('click', BMT_toggleButtonClick);
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


// Export functions
export {
    createCharacterCard,
    createCardContainer,
    generateCharacterColors
};