/**
 * @file Token-efficient data handling for BunnyMoTags
 * Strips formatting and optimizes data for AI context while preserving display data
 */

import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'BunnyMoTags-TokenOptimizer';
const extensionName = 'BunnyMoTags';

// Create minimal, token-efficient character data for AI context
const optimizeForAI = (characterData, settings = {}) => {
    const {
        maxCharacters = 6,
        priorityTags = ['species', 'personality', 'physical'],
        maxTagsPerCategory = 3,
        compactFormat = true
    } = settings;

    if (!characterData || !characterData.characters) {
        return null;
    }

    // Limit number of characters
    const characters = characterData.characters.slice(0, maxCharacters);
    
    const optimizedCharacters = characters.map(char => {
        const optimizedChar = {
            name: char.name,
            tags: {}
        };

        // Prioritize important tag categories
        priorityTags.forEach(category => {
            if (char.tags[category] && Array.isArray(char.tags[category])) {
                // Limit tags per category to save tokens
                optimizedChar.tags[category] = char.tags[category]
                    .slice(0, maxTagsPerCategory)
                    .filter(tag => tag && tag.trim().length > 0);
            }
        });

        // Add other categories if space allows, but limit them more aggressively
        Object.entries(char.tags).forEach(([category, tags]) => {
            if (!priorityTags.includes(category) && Array.isArray(tags) && tags.length > 0) {
                optimizedChar.tags[category] = tags
                    .slice(0, 2) // Even more aggressive limiting for non-priority tags
                    .filter(tag => tag && tag.trim().length > 0);
            }
        });

        return optimizedChar;
    });

    return {
        characters: optimizedCharacters.filter(char => Object.keys(char.tags).length > 0)
    };
};

// Generate ultra-compact format for AI consumption
const generateCompactFormat = (optimizedData) => {
    if (!optimizedData || !optimizedData.characters.length) {
        return '';
    }

    let compactText = '';
    
    optimizedData.characters.forEach((char, index) => {
        if (index > 0) compactText += '\n';
        compactText += `${char.name}:`;
        
        const tagStrings = [];
        Object.entries(char.tags).forEach(([category, tags]) => {
            if (tags.length > 0) {
                tagStrings.push(`${category}(${tags.join(',')})`);
            }
        });
        
        compactText += ` ${tagStrings.join(' ')}`;
    });
    
    return compactText;
};

// Generate standard JSON format but optimized
const generateOptimizedJSON = (optimizedData) => {
    if (!optimizedData || !optimizedData.characters.length) {
        return '{}';
    }

    // Use minimal JSON with no pretty printing to save tokens
    return JSON.stringify(optimizedData);
};

// Strip all formatting and visual elements from message content
const stripFormattingForAI = (messageContent) => {
    if (!messageContent) return messageContent;
    
    // Remove BunnyMo code blocks but preserve the data in optimized form
    return messageContent.replace(/```bunnymo\n([\s\S]*?)\n```/g, (match, content) => {
        try {
            // Parse the original data
            const fullData = JSON.parse(content);
            
            // Get optimization settings
            const settings = extension_settings[extensionName] || {};
            const optimizationSettings = {
                maxCharacters: settings.aiMaxCharacters || 4,
                priorityTags: settings.aiPriorityTags || ['species', 'personality', 'physical'],
                maxTagsPerCategory: settings.aiMaxTagsPerCategory || 2,
                compactFormat: settings.aiUseCompactFormat !== false
            };
            
            // Optimize for AI context
            const optimized = optimizeForAI(fullData, optimizationSettings);
            
            if (!optimized || optimized.characters.length === 0) {
                return ''; // Remove empty blocks entirely
            }
            
            // Return in the most token-efficient format
            if (optimizationSettings.compactFormat) {
                return `[CharacterTags: ${generateCompactFormat(optimized)}]`;
            } else {
                return `\`\`\`bunnymo\n${generateOptimizedJSON(optimized)}\n\`\`\``;
            }
            
        } catch (error) {
            console.warn(`[${MODULE_NAME}] Failed to optimize BunnyMo data for AI:`, error);
            return match; // Return original on error
        }
    });
};

// Calculate token savings
const calculateTokenSavings = (originalData, optimizedData) => {
    const originalStr = JSON.stringify(originalData);
    const optimizedStr = generateCompactFormat(optimizedData);
    
    // Rough token estimation (1 token ≈ 4 characters)
    const originalTokens = Math.ceil(originalStr.length / 4);
    const optimizedTokens = Math.ceil(optimizedStr.length / 4);
    const savings = originalTokens - optimizedTokens;
    const savingsPercent = originalTokens > 0 ? Math.round((savings / originalTokens) * 100) : 0;
    
    return {
        originalTokens,
        optimizedTokens,
        savings,
        savingsPercent
    };
};

// Process message before sending to AI
const processMessageForAI = (messageContent, isUserMessage = false) => {
    if (!messageContent) return messageContent;
    
    const settings = extension_settings[extensionName] || {};
    
    // Only process if sendToAI is enabled
    if (!settings.sendToAI) {
        // If sendToAI is disabled, strip all BunnyMo blocks entirely
        return messageContent.replace(/```bunnymo\n[\s\S]*?\n```/g, '');
    }
    
    // For user messages, apply more aggressive optimization
    if (isUserMessage && settings.optimizeUserMessages !== false) {
        return stripFormattingForAI(messageContent);
    }
    
    // For AI messages, preserve data but optimize
    return stripFormattingForAI(messageContent);
};

// Extract original data from message for display purposes
const extractDisplayData = (messageContent) => {
    const bunnyMoBlocks = [];
    const regex = /```bunnymo\n([\s\S]*?)\n```/g;
    let match;
    
    while ((match = regex.exec(messageContent)) !== null) {
        try {
            const data = JSON.parse(match[1]);
            bunnyMoBlocks.push(data);
        } catch (error) {
            // Try parsing as compact format
            try {
                const lines = match[1].trim().split('\n');
                const characters = [];
                
                lines.forEach(line => {
                    const [name, ...tagParts] = line.split(':');
                    if (tagParts.length > 0) {
                        const char = { name: name.trim(), tags: {} };
                        const tagString = tagParts.join(':').trim();
                        
                        // Parse compact format: category(tag1,tag2) category2(tag3,tag4)
                        const categoryRegex = /(\w+)\(([^)]+)\)/g;
                        let categoryMatch;
                        
                        while ((categoryMatch = categoryRegex.exec(tagString)) !== null) {
                            const [, category, tags] = categoryMatch;
                            char.tags[category] = tags.split(',').map(t => t.trim());
                        }
                        
                        if (Object.keys(char.tags).length > 0) {
                            characters.push(char);
                        }
                    }
                });
                
                if (characters.length > 0) {
                    bunnyMoBlocks.push({ characters });
                }
            } catch (parseError) {
                console.warn(`[${MODULE_NAME}] Failed to parse BunnyMo block:`, parseError);
            }
        }
    }
    
    return bunnyMoBlocks;
};

// Debug function to show optimization results
const debugOptimization = (originalData, messageId = null) => {
    const settings = extension_settings[extensionName] || {};
    if (!settings.debugMode) return;
    
    const optimized = optimizeForAI(originalData);
    const savings = calculateTokenSavings(originalData, optimized);
    
    console.log(`[${MODULE_NAME}] Optimization Results${messageId ? ` (Message ${messageId})` : ''}:`);
    console.log('Original tokens:', savings.originalTokens);
    console.log('Optimized tokens:', savings.optimizedTokens);
    console.log('Token savings:', savings.savings, `(${savings.savingsPercent}%)`);
    console.log('Compact format:', generateCompactFormat(optimized));
};

export {
    optimizeForAI,
    generateCompactFormat,
    generateOptimizedJSON,
    stripFormattingForAI,
    processMessageForAI,
    extractDisplayData,
    calculateTokenSavings,
    debugOptimization
};