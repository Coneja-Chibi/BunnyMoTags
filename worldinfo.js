// BunnyMoWorldInfo - Professional WorldInfo display system
// Sleek, minimal design matching SillyTavern's native aesthetic

import { chat, chat_metadata, event_types, eventSource, main_api, saveSettingsDebounced } from '../../../../script.js';
import { metadata_keys } from '../../../authors-note.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { world_info_position } from '../../../world-info.js';
import { delay } from '../../../utils.js';

function logSeq(message) {
    console.log(`[BMT WORLD] ${message}`);
}

/**
 * Get the effective scanDepth for a WorldInfo entry, taking into account 
 * any scanDepth override from global settings, chat, or character configuration
 */
function getEffectiveScanDepth(entry) {
    // Check for scanDepth override in order of precedence:
    // 1. Chat-specific configuration (highest priority)
    // 2. Character-specific configuration
    // 3. Global extension setting
    // 4. Entry's own scanDepth setting
    // 5. Default value (5)
    
    const context = getContext();
    let scanDepthOverride = null;
    
    // Check chat-specific configuration first
    const chatConfig = context?.chat_metadata?.bunnymo_config;
    if (chatConfig?.scan_depth_override !== undefined && chatConfig.scan_depth_override > 0) {
        scanDepthOverride = chatConfig.scan_depth_override;
    }
    
    // Check character-specific configuration if no chat config
    if (scanDepthOverride === null) {
        const characterConfig = context?.characters?.[context.characterId]?.data?.extensions?.bunnymo_config;
        if (characterConfig?.scan_depth_override !== undefined && characterConfig.scan_depth_override > 0) {
            scanDepthOverride = characterConfig.scan_depth_override;
        }
    }
    
    // Check global extension setting if no per-chat or per-character override
    if (scanDepthOverride === null) {
        const globalScanDepth = extension_settings.BunnyMoTags?.globalScanDepth;
        if (globalScanDepth !== undefined && globalScanDepth > 0) {
            scanDepthOverride = globalScanDepth;
        }
    }
    
    // Return override if available, otherwise use entry's scanDepth or default to 5
    return scanDepthOverride !== null ? scanDepthOverride : (entry.scanDepth || 5);
}

// Clean strategy indicators
const strategy = {
    constant: '🥕',
    normal: '🟢', 
    vectorized: '🔗',
    bunnymo: '🐰',
};

const getStrategy = (entry) => {
    if (entry.bunnymo_character) return 'bunnymo';
    if (entry.constant === true) return 'constant';
    if (entry.vectorized === true) return 'vectorized';
    return 'normal';
};

// Helper function to check if a lorebook is character-related
const isCharacterLorebook = (entry) => {
    if (!entry.world) return false;
    
    try {
        const context = getContext();
        if (!context.characters || context.characterId === undefined) return false;
        
        // Check if this is the current character's primary lorebook
        const character = context.characters[context.characterId];
        const primaryCharWorld = character?.data?.extensions?.world;
        if (primaryCharWorld === entry.world) {
            return true;
        }
        
        // Check if this is in character's extra lorebooks (charLore)
        const fileName = context.characters[context.characterId]?.avatar?.replace(/\.[^/.]+$/, "");
        const extraCharLore = window.world_info?.charLore?.find((e) => e.name === fileName);
        if (extraCharLore?.extraBooks?.includes(entry.world)) {
            return true;
        }
        
        return false;
    } catch (error) {
        console.warn('[BMT WORLD] Error checking character lorebook:', error);
        return false;
    }
};

const getEntryCategory = (entry) => {
    // Priority 1: BunnyMo specific markings
    if (entry.bunnymo_character) return 'Characters';
    
    // Priority 2: SillyTavern entry types
    if (entry.constant) return 'Constants';
    if (entry.vectorized) return 'Vectorized';
    
    // Priority 3: Check if entry comes from a character-related lorebook
    if (isCharacterLorebook(entry)) return 'Characters';
    
    // Priority 4: Content-based categorization for non-character lorebooks
    const keywords = entry.key ? entry.key.join(' ').toLowerCase() : '';
    const content = (entry.content || '').toLowerCase();
    const comment = (entry.comment || '').toLowerCase();
    
    // Check entry name/title for character emojis first (most reliable)
    const entryTitle = (entry.comment || entry.key?.[0] || '').toLowerCase();
    if (entryTitle.match(/^(👑|🧙|👤|🧝|🧛|👸|🤴|👨|👩|🧑)/)) return 'Characters';
    
    // Use more precise content matching - avoid overly broad terms
    const allText = `${keywords} ${content} ${comment}`;
    
    // Be more selective with patterns to avoid false matches
    if (allText.match(/\b(character|person|npc|people)\b/i)) return 'Characters';
    if (allText.match(/\b(location|place|city|town|building|room)\b/i)) return 'Locations';  
    if (allText.match(/\b(item|object|weapon|tool|artifact)\b/i)) return 'Objects';
    if (allText.match(/\b(event|history|story|lore|legend)\b/i)) return 'Events/Lore';
    if (allText.match(/\b(rule|law|magic|system|mechanic)\b/i)) return 'Rules/Systems';
    
    return 'General';
};

let generationType;
let currentEntries = [];
let scannedCharacters = new Map();

// PRECISE ACTIVATION TRACKING - No more guessing!
let activationTracker = {
    currentScan: null,
    recursionChain: [],
    forceActivated: new Set(),
    vectorActivated: new Set(),
    programmaticActivated: new Map(), // uid -> source info
    scanDepthActivated: new Map(), // uid -> depth info
    groupScoringActivated: new Set(),
    minActivationsTriggered: new Set(),
    
    reset() {
        this.currentScan = null;
        this.recursionChain = [];
        this.forceActivated.clear();
        this.vectorActivated.clear();
        this.programmaticActivated.clear();
        this.scanDepthActivated.clear();
        this.groupScoringActivated.clear();
        this.minActivationsTriggered.clear();
        
        // Clean up old data to prevent memory leaks
        this.cleanup();
    },
    
    cleanup() {
        const now = Date.now();
        const maxAge = 5 * 60 * 1000; // 5 minutes
        
        // Clean old recursion chains
        this.recursionChain = this.recursionChain.filter(chain => 
            chain.timestamp && (now - chain.timestamp) < maxAge
        ).slice(-100); // Keep max 100 entries
        
        // Clean old programmatic activations
        for (const [uid, data] of this.programmaticActivated.entries()) {
            if (data.timestamp && (now - data.timestamp) > maxAge) {
                this.programmaticActivated.delete(uid);
            }
        }
        
        // Limit map sizes to prevent excessive memory usage
        if (this.programmaticActivated.size > 200) {
            const entries = [...this.programmaticActivated.entries()].slice(-100);
            this.programmaticActivated.clear();
            entries.forEach(([k, v]) => this.programmaticActivated.set(k, v));
        }
        
        if (this.scanDepthActivated.size > 200) {
            const entries = [...this.scanDepthActivated.entries()].slice(-100);
            this.scanDepthActivated.clear();
            entries.forEach(([k, v]) => this.scanDepthActivated.set(k, v));
        }
    },
    
    markRecursion(parentUid, childUid) {
        this.recursionChain.push({ parent: parentUid, child: childUid, timestamp: Date.now() });
    },
    
    markForceActivated(uid, source) {
        this.forceActivated.add(uid);
        this.programmaticActivated.set(uid, { type: 'force', source, timestamp: Date.now() });
    },
    
    markVectorActivated(uid, vectorType) {
        this.vectorActivated.add(uid);
        this.programmaticActivated.set(uid, { type: 'vector', vectorType, timestamp: Date.now() });
    },
    
    markScanDepthActivated(uid, depth, reason) {
        this.scanDepthActivated.set(uid, { depth, reason, timestamp: Date.now() });
    },
    
    getRecursionParent(uid) {
        const chain = this.recursionChain.find(r => r.child === uid);
        return chain ? chain.parent : null;
    }
};

// Console interception system removed - was interfering with proper categorization

// Reverse-engineered ST trigger detection using ST's exact algorithm from world-info.js
const reverseEngineerSTTriggers = (entry, recentMessages) => {
    // Recreate ST's WorldInfo logic based on checkWorldInfo() function (lines 4243+)
    
    // 1. Check special activation methods first (ST lines 4409-4437)
    
    // @@activate decorator (ST line 4409)
    if (entry.decorators && entry.decorators.includes('@@activate')) {
        return {
            triggered: true,
            type: 'decorator_activate',
            reason: '@@activate Decorator',
            icon: '⚡',
            color: '#FF4500',
            summary: '⚡ DECORATOR - @@activate forced activation',
            details: {
                explanation: 'Entry was force-activated by the @@activate decorator'
            }
        };
    }
    
    // @@dont_activate decorator (ST line 4415) - this would prevent activation
    if (entry.decorators && entry.decorators.includes('@@dont_activate')) {
        return { triggered: false, reason: 'Suppressed by @@dont_activate decorator' };
    }
    
    // Constant entries (ST line 4427)
    if (entry.constant === true) {
        return {
            triggered: true,
            type: 'constant',
            reason: 'Constant Entry - Always Active',
            icon: '🔵',
            color: '#4169E1',
            summary: '🔵 CONSTANT - Always fires regardless of keywords',
            details: {
                explanation: 'This entry is marked as constant and will always be activated during any generation, regardless of chat content or keywords.'
            }
        };
    }
    
    // Vectorized entries (ST uses entry.vectorized flag)
    if (entry.vectorized === true) {
        return {
            triggered: true,
            type: 'vectorized',
            reason: 'Vectorized Entry - Semantic Similarity',
            icon: '🔗',
            color: '#9966CC',
            summary: '🔗 VECTORIZED - Triggered by semantic similarity',
            details: {
                explanation: 'This entry was activated by the vectors extension using semantic similarity matching, not keyword matching.'
            }
        };
    }
    
    // Sticky entries (would need to check if currently active - complex)
    // Note: Sticky detection requires checking WorldInfoTimedEffects which is complex
    // We'll handle this as a fallback case
    
    // External activation (ST line 4420) - would need access to buffer.getExternallyActivated()
    // This is complex and requires ST's internal state
    
    // 2. Check if entry has keys for normal keyword matching (ST line 4439)
    if (!entry.key || !Array.isArray(entry.key) || entry.key.length === 0) {
        return { triggered: false, reason: 'No keywords defined' };
    }
    
    // 2. Build scan text like ST's WorldInfoBuffer.get() (lines 295-312)
    let scanText = '';
    
    // Add global context fields if enabled (exactly like ST)
    const globalContext = [];
    if (entry.matchPersonaDescription && window.power_user?.persona_description) {
        globalContext.push('Persona Description');
        scanText += '\n' + window.power_user.persona_description;
    }
    if (entry.matchCharacterDescription && window.this_chid !== undefined) {
        globalContext.push('Character Description');
        const character = getContext?.()?.characters?.[window.this_chid];
        if (character?.description) {
            scanText += '\n' + character.description;
        }
    }
    if (entry.matchCharacterPersonality && window.this_chid !== undefined) {
        globalContext.push('Character Personality');
        const character = getContext?.()?.characters?.[window.this_chid];
        if (character?.personality) {
            scanText += '\n' + character.personality;
        }
    }
    if (entry.matchCharacterDepthPrompt && window.this_chid !== undefined) {
        globalContext.push('Character Depth Prompt');
        const character = getContext?.()?.characters?.[window.this_chid];
        if (character?.depth_prompt) {
            scanText += '\n' + character.depth_prompt;
        }
    }
    if (entry.matchScenario && window.this_chid !== undefined) {
        globalContext.push('Scenario');
        const character = getContext?.()?.characters?.[window.this_chid];
        if (character?.scenario) {
            scanText += '\n' + character.scenario;
        }
    }
    if (entry.matchCreatorNotes && window.this_chid !== undefined) {
        globalContext.push('Creator Notes');
        const character = getContext?.()?.characters?.[window.this_chid];
        if (character?.creator_notes) {
            scanText += '\n' + character.creator_notes;
        }
    }
    
    // Add chat messages (limited depth based on entry.scanDepth)
    if (recentMessages && recentMessages.length > 0) {
        const effectiveScanDepth = getEffectiveScanDepth(entry);
        const messagesToScan = recentMessages.slice(-effectiveScanDepth);
        scanText += '\n' + messagesToScan.map(m => m.mes || '').join('\n');
    }
    
    // 3. Primary keyword matching (ST lines 4448-4451)
    let primaryKeyMatch = null;
    for (const key of entry.key) {
        if (key && stMatchKeys(scanText, key, entry)) {
            primaryKeyMatch = key;
            break;
        }
    }
    
    if (!primaryKeyMatch) {
        return { triggered: false, reason: 'No primary keyword matches' };
    }
    
    // 4. Check secondary keywords if they exist (ST lines 4458-4522)
    const hasSecondaryKeywords = entry.selective && 
                                 Array.isArray(entry.keysecondary) && 
                                 entry.keysecondary.length > 0;
    
    if (!hasSecondaryKeywords) {
        // Primary match only - determine source
        if (globalContext.length > 0) {
            const result = {
                triggered: true,
                type: 'global_context',
                reason: 'Global Context Matching',
                icon: '🌍',
                color: '#228B22',
                summary: `🌍 GLOBAL - Matched ${globalContext.join(', ')}`,
                details: {
                    primaryKeyword: primaryKeyMatch,
                    globalMatches: globalContext,
                    explanation: `Primary keyword "${primaryKeyMatch}" matched in global context: ${globalContext.join(', ')}`
                }
            };
            addProbabilityInfo(result, entry);
            return result;
        } else {
            const result = {
                triggered: true,
                type: 'keyword_match',
                reason: 'Keyword Match in Chat',
                icon: '💬',
                color: '#4169E1',
                summary: `💬 CHAT - Keyword "${primaryKeyMatch}"`,
                details: {
                    primaryKeyword: primaryKeyMatch,
                    explanation: `Primary keyword "${primaryKeyMatch}" matched in recent chat messages`
                }
            };
            addProbabilityInfo(result, entry);
            return result;
        }
    }
    
    // 5. Secondary keyword logic (ST lines 4477-4512)
    const selectiveLogic = entry.selectiveLogic ?? 0; // Default to AND_ANY
    let hasAnySecondaryMatch = false;
    let hasAllSecondaryMatch = true;
    let matchedSecondaryKeys = [];
    
    for (const secondaryKey of entry.keysecondary) {
        if (secondaryKey && stMatchKeys(scanText, secondaryKey, entry)) {
            hasAnySecondaryMatch = true;
            matchedSecondaryKeys.push(secondaryKey);
        } else {
            hasAllSecondaryMatch = false;
        }
        
        // Early exit for AND_ANY (logic 0) and NOT_ALL (logic 3)
        if (selectiveLogic === 0 && hasAnySecondaryMatch) break; // AND_ANY
        if (selectiveLogic === 3 && !hasAllSecondaryMatch) break; // NOT_ALL
    }
    
    // Evaluate secondary logic
    let secondaryLogicPassed = false;
    let logicDescription = '';
    
    switch (selectiveLogic) {
        case 0: // AND_ANY
            secondaryLogicPassed = hasAnySecondaryMatch;
            logicDescription = 'AND_ANY';
            break;
        case 1: // AND_ALL
            secondaryLogicPassed = hasAllSecondaryMatch;
            logicDescription = 'AND_ALL';
            break;
        case 2: // NOT_ANY
            secondaryLogicPassed = !hasAnySecondaryMatch;
            logicDescription = 'NOT_ANY';
            break;
        case 3: // NOT_ALL
            secondaryLogicPassed = !hasAllSecondaryMatch;
            logicDescription = 'NOT_ALL';
            break;
    }
    
    if (!secondaryLogicPassed) {
        return { 
            triggered: false, 
            reason: `Secondary keywords failed ${logicDescription} logic`,
            primaryKeyword: primaryKeyMatch,
            secondaryLogic: logicDescription
        };
    }
    
    // Success with secondary keywords
    if (globalContext.length > 0) {
        const result = {
            triggered: true,
            type: 'global_context_with_secondary',
            reason: 'Global Context + Secondary Keywords',
            icon: '🌍',
            color: '#228B22',
            summary: `🌍 GLOBAL - "${primaryKeyMatch}" + ${logicDescription}`,
            details: {
                primaryKeyword: primaryKeyMatch,
                secondaryKeywords: matchedSecondaryKeys,
                secondaryLogic: logicDescription,
                globalMatches: globalContext,
                explanation: `Primary keyword "${primaryKeyMatch}" and secondary keywords (${logicDescription}) matched in global context: ${globalContext.join(', ')}`
            }
        };
        addProbabilityInfo(result, entry);
        return result;
    } else {
        const result = {
            triggered: true,
            type: 'keyword_with_secondary',
            reason: 'Keywords + Secondary Logic',
            icon: '💬',
            color: '#4169E1',
            summary: `💬 CHAT - "${primaryKeyMatch}" + ${logicDescription}`,
            details: {
                primaryKeyword: primaryKeyMatch,
                secondaryKeywords: matchedSecondaryKeys,
                secondaryLogic: logicDescription,
                explanation: `Primary keyword "${primaryKeyMatch}" and secondary keywords (${logicDescription}) matched in chat`
            }
        };
        addProbabilityInfo(result, entry);
        return result;
    }
};

// Helper to add probability information to trigger analysis
const addProbabilityInfo = (result, entry) => {
    if (entry.useProbability && entry.probability && entry.probability < 100) {
        result.details.probability = `${entry.probability}% chance`;
        result.details.explanation += ` (Entry has ${entry.probability}% activation probability - since it triggered, the probability roll succeeded)`;
        result.summary += ` (${entry.probability}%)`;
    }
};

// ST's exact matchKeys logic from WorldInfoBuffer.matchKeys() (lines 333-363)
const stMatchKeys = (haystack, needle, entry) => {
    if (!haystack || !needle) return false;
    
    // Check for regex pattern (ST uses parseRegexFromString)
    const regexMatch = needle.match(/^\/(.+)\/([gim]*)$/);
    if (regexMatch) {
        try {
            const regex = new RegExp(regexMatch[1], regexMatch[2]);
            return regex.test(haystack);
        } catch (e) {
            return false;
        }
    }
    
    // Apply case sensitivity (ST's #transformString)
    const caseSensitive = entry.caseSensitive ?? false;
    if (!caseSensitive) {
        haystack = haystack.toLowerCase();
        needle = needle.toLowerCase();
    }
    
    // Apply whole word matching
    const matchWholeWords = entry.matchWholeWords ?? false;
    if (matchWholeWords) {
        const keyWords = needle.trim().split(/\s+/);
        
        if (keyWords.length > 1) {
            // Multi-word phrase - use includes
            return haystack.includes(needle);
        } else {
            // Single word - use word boundaries
            const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(?:^|\\W)(${escapedNeedle})(?:$|\\W)`);
            return regex.test(haystack);
        }
    } else {
        return haystack.includes(needle);
    }
};

// =============================================================================
// MODULAR WORLDINFO TRIGGER DETECTION SYSTEM
// Each trigger type gets its own specialized detector for better accuracy
// =============================================================================

class WIConstantDetector {
    static detect(entry) {
        if (entry.constant === true) {
            return {
                triggered: true,
                type: 'constant',
                reason: 'Constant Entry - Always Active',
                icon: '🔵',
                color: '#4169E1',
                summary: '🔵 CONSTANT - Always fires regardless of keywords',
                details: {
                    explanation: 'This entry is marked as constant and will always be activated during any generation, regardless of chat content or keywords.'
                }
            };
        }
        return { triggered: false };
    }
}

class WIDecoratorDetector {
    static detect(entry) {
        if (entry.decorators && entry.decorators.includes('@@activate')) {
            return {
                triggered: true,
                type: 'decorator_activate',
                reason: '@@activate Decorator',
                icon: '⚡',
                color: '#FF4500',
                summary: '⚡ DECORATOR - @@activate forced activation',
                details: {
                    explanation: 'Entry was force-activated by the @@activate decorator'
                }
            };
        }
        
        if (entry.decorators && entry.decorators.includes('@@dont_activate')) {
            return { 
                triggered: false, 
                reason: 'Suppressed by @@dont_activate decorator',
                suppressed: true 
            };
        }
        
        return { triggered: false };
    }
}

class WIVectorizedDetector {
    static detect(entry) {
        if (entry.vectorized === true) {
            return {
                triggered: true,
                type: 'vectorized',
                reason: 'Vectorized Entry - Semantic Similarity',
                icon: '🔗',
                color: '#9966CC',
                summary: '🔗 VECTORIZED - Triggered by semantic similarity',
                details: {
                    explanation: 'This entry was activated by the vectors extension using semantic similarity matching, not keyword matching.'
                }
            };
        }
        return { triggered: false };
    }
}

class WIStickyDetector {
    static detect(entry) {
        if (entry.sticky && (entry.sticky > 0 || entry.stickyRemaining > 0)) {
            return {
                triggered: true,
                type: 'sticky',
                reason: 'Sticky Entry - Timed Activation',
                icon: '📌',
                color: '#FF6347',
                summary: '📌 STICKY - Active from previous trigger',
                details: {
                    explanation: 'This entry is currently sticky and remains active from a previous trigger.',
                    remainingMessages: entry.stickyRemaining || 'unknown'
                }
            };
        }
        return { triggered: false };
    }
}

class WIGlobalContextDetector {
    static detect(entry) {
        const globalMatches = [];
        if (entry.matchPersonaDescription) globalMatches.push('Persona Description');
        if (entry.matchCharacterDescription) globalMatches.push('Character Description'); 
        if (entry.matchCharacterPersonality) globalMatches.push('Character Personality');
        if (entry.matchCharacterDepthPrompt) globalMatches.push('Character Depth Prompt');
        if (entry.matchScenario) globalMatches.push('Scenario');
        if (entry.matchCreatorNotes) globalMatches.push('Creator Notes');
        
        if (globalMatches.length > 0) {
            return {
                triggered: true,
                type: 'global_context',
                reason: 'Global Context Matching',
                icon: '🌍',
                color: '#228B22',
                summary: `🌍 GLOBAL - Matched ${globalMatches.join(', ')}`,
                details: {
                    globalMatches: globalMatches,
                    explanation: `This entry was activated by matching against global context: ${globalMatches.join(', ')}.`
                }
            };
        }
        
        return { triggered: false };
    }
}

class WIKeywordDetector {
    static detect(entry, recentMessages) {
        if (!entry.key || !Array.isArray(entry.key) || entry.key.length === 0) {
            return { triggered: false, reason: 'No keywords defined' };
        }

        // Build scan text from chat messages
        let scanText = '';
        if (recentMessages && recentMessages.length > 0) {
            const effectiveScanDepth = getEffectiveScanDepth(entry);
            const messagesToScan = recentMessages.slice(-effectiveScanDepth);
            scanText = messagesToScan.map(m => m.mes || '').join('\n');
        }

        // Check primary keywords
        let primaryKeyMatch = null;
        for (const key of entry.key) {
            if (key && this.matchKeyword(scanText, key, entry)) {
                primaryKeyMatch = key;
                break;
            }
        }

        if (!primaryKeyMatch) {
            return { triggered: false, reason: 'No primary keyword matches' };
        }

        // Check secondary keywords if they exist
        const hasSecondaryKeywords = entry.selective && 
                                     Array.isArray(entry.keysecondary) && 
                                     entry.keysecondary.length > 0;

        if (!hasSecondaryKeywords) {
            return {
                triggered: true,
                type: 'keyword_match',
                reason: 'Primary Keyword Match',
                icon: '💬',
                color: '#4169E1',
                summary: `💬 CHAT - Keyword "${primaryKeyMatch}"`,
                details: {
                    primaryKeyword: primaryKeyMatch,
                    explanation: `Primary keyword "${primaryKeyMatch}" matched in recent chat messages`
                }
            };
        }

        // Handle secondary keyword logic
        const secondaryResult = this.evaluateSecondaryKeywords(entry, scanText, primaryKeyMatch);
        return secondaryResult;
    }

    static matchKeyword(haystack, needle, entry) {
        if (!haystack || !needle) return false;
        
        // Check for regex pattern
        const regexMatch = needle.match(/^\/(.+)\/([gim]*)$/);
        if (regexMatch) {
            try {
                const regex = new RegExp(regexMatch[1], regexMatch[2]);
                return regex.test(haystack);
            } catch (e) {
                return false;
            }
        }
        
        // Apply case sensitivity
        const caseSensitive = entry.caseSensitive ?? false;
        if (!caseSensitive) {
            haystack = haystack.toLowerCase();
            needle = needle.toLowerCase();
        }
        
        // Apply whole word matching
        const matchWholeWords = entry.matchWholeWords ?? false;
        if (matchWholeWords) {
            const keyWords = needle.trim().split(/\s+/);
            
            if (keyWords.length > 1) {
                return haystack.includes(needle);
            } else {
                const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(?:^|\\W)(${escapedNeedle})(?:$|\\W)`);
                return regex.test(haystack);
            }
        } else {
            return haystack.includes(needle);
        }
    }

    static evaluateSecondaryKeywords(entry, scanText, primaryKeyMatch) {
        const selectiveLogic = entry.selectiveLogic ?? 0;
        let hasAnySecondaryMatch = false;
        let hasAllSecondaryMatch = true;
        let matchedSecondaryKeys = [];
        
        for (const secondaryKey of entry.keysecondary) {
            if (secondaryKey && this.matchKeyword(scanText, secondaryKey, entry)) {
                hasAnySecondaryMatch = true;
                matchedSecondaryKeys.push(secondaryKey);
            } else {
                hasAllSecondaryMatch = false;
            }
        }
        
        // Evaluate logic
        let logicPassed = false;
        let logicDescription = '';
        
        switch (selectiveLogic) {
            case 0: // AND_ANY
                logicPassed = hasAnySecondaryMatch;
                logicDescription = 'AND_ANY';
                break;
            case 1: // AND_ALL
                logicPassed = hasAllSecondaryMatch;
                logicDescription = 'AND_ALL';
                break;
            case 2: // NOT_ANY
                logicPassed = !hasAnySecondaryMatch;
                logicDescription = 'NOT_ANY';
                break;
            case 3: // NOT_ALL
                logicPassed = !hasAllSecondaryMatch;
                logicDescription = 'NOT_ALL';
                break;
        }
        
        if (!logicPassed) {
            return { 
                triggered: false, 
                reason: `Secondary keywords failed ${logicDescription} logic`,
                primaryKeyword: primaryKeyMatch,
                secondaryLogic: logicDescription
            };
        }
        
        return {
            triggered: true,
            type: 'keyword_with_secondary',
            reason: 'Keywords + Secondary Logic',
            icon: '💬',
            color: '#4169E1',
            summary: `💬 CHAT - "${primaryKeyMatch}" + ${logicDescription}`,
            details: {
                primaryKeyword: primaryKeyMatch,
                secondaryKeywords: matchedSecondaryKeys,
                secondaryLogic: logicDescription,
                explanation: `Primary keyword "${primaryKeyMatch}" and secondary keywords (${logicDescription}) matched in chat`
            }
        };
    }
}

class WIProbabilityDetector {
    static addProbabilityInfo(result, entry) {
        if (entry.useProbability && entry.probability && entry.probability < 100) {
            result.details.probability = `${entry.probability}% chance`;
            result.details.explanation += ` (Entry has ${entry.probability}% activation probability - since it triggered, the probability roll succeeded)`;
            result.summary += ` (${entry.probability}%)`;
        }
        return result;
    }
}

class WIBunnyMoTagDetector {
    static detect(entry) {
        if (!entry.world) return { triggered: false };
        
        // Get BunnyMo configuration to check if this world is in character repos or tag libraries
        const settings = extension_settings.bunnyMo || {};
        const characterRepos = new Set(settings.character_repositories || []);
        const tagLibraries = new Set(settings.tag_libraries || []);
        
        const isCharacterRepo = characterRepos.has(entry.world);
        const isTagLibrary = tagLibraries.has(entry.world);
        
        if (isCharacterRepo || isTagLibrary) {
            return this.createBunnyMoResult(entry, isCharacterRepo ? 'character_repo' : 'tag_library');
        }
        
        return { triggered: false };
    }

    static createBunnyMoResult(entry, detectionMethod) {
        let specificType, icon, color, systemType;

        if (detectionMethod === 'character_repo') {
            systemType = 'Character Repository';
            icon = '👤';
            color = '#4A90E2';
            specificType = 'Character Repository System';
        } else if (detectionMethod === 'tag_library') {
            systemType = 'Tag Library';
            icon = '🏷️';
            color = '#E24A90';
            
            // Further categorize tag libraries based on content
            if (entry.comment) {
                const comment = entry.comment.toLowerCase();
                if (comment.includes('linguistics') || comment.includes('command') || comment.includes('flirt')) {
                    specificType = 'Linguistics Framework';
                    icon = '🗣️';
                } else if (comment.includes('dere') || comment.includes('kuudere') || comment.includes('sadodere')) {
                    specificType = 'Dere Type System';
                    icon = '💖';
                } else if (comment.includes('anti clanker') || comment.includes('clanker')) {
                    specificType = 'Anti-Clanker System';
                    icon = '🛡️';
                    color = '#50C878';
                } else if (comment.includes('species') || comment.includes('human') || comment.includes('oni')) {
                    specificType = 'Species/Character Type';
                    icon = '👤';
                    color = '#9B59B6';
                } else if (comment.includes('auto-trigger') || comment.includes('filtration')) {
                    specificType = 'Auto-Trigger System';
                    icon = '⚙️';
                    color = '#F39C12';
                } else {
                    specificType = 'Tag Library System';
                }
            } else {
                specificType = 'Tag Library System';
            }
        } else {
            systemType = 'BunnyMo System';
            specificType = 'Unknown BunnyMo System';
            icon = '🥕';
            color = '#FF6B35';
        }

        return {
            triggered: true,
            type: detectionMethod === 'character_repo' ? 'bunnymo_character_repo' : 'bunnymo_tag_library',
            reason: `BunnyMo ${systemType}`,
            icon: icon,
            color: color,
            summary: `${icon} BUNNYMO - ${specificType}`,
            details: {
                explanation: `This entry was activated by BunnyMo's ${systemType.toLowerCase()} system (${specificType}).`,
                detectionMethod: detectionMethod,
                worldName: entry.world || 'unknown',
                bunnymoType: specificType,
                systemType: systemType
            }
        };
    }
}

class WIInterLorebookDetector {
    static detect(entry, currentEntries) {
        if (!currentEntries || currentEntries.length <= 1) {
            return { triggered: false };
        }

        // Performance limit
        if (currentEntries.length > 50) {
            return { triggered: false, reason: 'Skipped due to performance (too many entries)' };
        }

        if (!entry.key || !Array.isArray(entry.key)) {
            return { triggered: false };
        }

        const otherEntries = currentEntries.filter(e => e.uid !== entry.uid);
        let foundInLorebook = false;
        let triggeringEntry = null;

        for (const otherEntry of otherEntries) {
            if (otherEntry.content) {
                const otherContent = otherEntry.content.toLowerCase();
                
                for (const keyword of entry.key) {
                    if (keyword && otherContent.includes(keyword.toLowerCase())) {
                        foundInLorebook = true;
                        triggeringEntry = otherEntry;
                        break;
                    }
                }
                
                if (foundInLorebook) break;
            }
        }

        if (foundInLorebook && triggeringEntry) {
            return {
                triggered: true,
                type: 'inter_lorebook',
                reason: 'Triggered by Another Lorebook Entry',
                icon: '🔄',
                color: '#FF8C00',
                summary: `🔄 INTER-LOREBOOK - Triggered by "${triggeringEntry.comment || triggeringEntry.key?.[0] || 'Unknown entry'}"`,
                details: {
                    explanation: `This entry was triggered by keywords found in another active lorebook entry: "${triggeringEntry.comment || triggeringEntry.key?.[0] || 'Unknown entry'}"`,
                    triggeringEntry: triggeringEntry.comment || triggeringEntry.key?.[0] || triggeringEntry.uid
                }
            };
        }

        return { triggered: false };
    }
}

// Helper to convert detector result to analysis format
const createAnalysisFromResult = (result, entry) => {
    const analysis = {
        triggerType: result.type,
        triggerReason: result.reason,
        triggerIcon: result.icon,
        triggerColor: result.color,
        summary: result.summary,
        details: result.details || {},
        isHighPriority: true,
        matchedKeys: result.details?.primaryKeyword ? [result.details.primaryKeyword] : [],
        triggeringMessages: [],
        lastMessageMatch: null
    };
    
    // Add probability information if applicable
    WIProbabilityDetector.addProbabilityInfo(analysis, entry);
    
    return analysis;
};

// Main modular detection system
const analyzeTriggerSources = (entry, recentMessages) => {
    // console.log(`[BMT WORLD] 🔍 Analyzing triggers for entry: ${entry.comment || entry.key?.[0] || entry.uid}`);
    // console.log(`[BMT WORLD] Entry trigger data:`, {
    //     triggerReason: entry.triggerReason,
    //     matchedText: entry.matchedText, 
    //     contextUsed: entry.contextUsed,
    //     activationReason: entry.activationReason
    // });
    
    // Initialize default analysis structure
    const analysis = {
        triggerType: 'unknown',
        triggerReason: '',
        triggerIcon: '❓',
        triggerColor: '#ff6b6b',
        matchedKeys: [],
        triggeringMessages: [],
        lastMessageMatch: null,
        summary: '',
        details: {},
        isHighPriority: false
    };
    
    // =============================================================================
    // MODULAR DETECTION SYSTEM - Each detector is a specialist
    // Ordered by priority: highest priority checks first
    // =============================================================================
    
    // 1. CONSTANT ENTRIES (always fire) - HIGHEST PRIORITY
    let result = WIConstantDetector.detect(entry);
    if (result.triggered) {
        return createAnalysisFromResult(result, entry);
    }
    
    // 2. DECORATOR ACTIVATION (@@activate, @@dont_activate) - HIGHEST PRIORITY
    result = WIDecoratorDetector.detect(entry);
    if (result.triggered || result.suppressed) {
        return result.suppressed ? { ...analysis, summary: 'SUPPRESSED - @@dont_activate' } : createAnalysisFromResult(result, entry);
    }
    
    // 3. VECTORIZED ENTRIES (semantic similarity) - HIGH PRIORITY
    result = WIVectorizedDetector.detect(entry);
    if (result.triggered) {
        return createAnalysisFromResult(result, entry);
    }
    
    // 4. STICKY ENTRIES (timed effects) - HIGH PRIORITY
    result = WIStickyDetector.detect(entry);
    if (result.triggered) {
        return createAnalysisFromResult(result, entry);
    }
    
    // 5. GLOBAL CONTEXT DETECTION - MEDIUM PRIORITY
    result = WIGlobalContextDetector.detect(entry);
    if (result.triggered) {
        return createAnalysisFromResult(result, entry);
    }
    
    // 6. BUNNYMO TAG SYSTEM DETECTION - MEDIUM PRIORITY
    result = WIBunnyMoTagDetector.detect(entry);
    if (result.triggered) {
        return createAnalysisFromResult(result, entry);
    }
    
    // 7. KEYWORD DETECTION (primary/secondary) - MEDIUM PRIORITY
    result = WIKeywordDetector.detect(entry, recentMessages);
    if (result.triggered) {
        return createAnalysisFromResult(result, entry);
    }
    
    // 8. INTER-LOREBOOK DETECTION - LOW PRIORITY (only if global context didn't match)
    result = WIInterLorebookDetector.detect(entry, currentEntries);
    if (result.triggered) {
        return createAnalysisFromResult(result, entry);
    }
    
    // FALLBACK: If reverse-engineered analysis didn't trigger, 
    // continue with other detection methods for special cases
    
    // PRIORITY CHECK 3: BunnyMo Character Tag Detection - DISABLED
    // Note: This detection was causing false positives. BunnyMoTags should only be labeled
    // when we can definitively prove the entry was activated by BunnyMo injection content,
    // not just because BunnyMo made an injection recently. Most character entries activate
    // due to normal keyword/context matching, even when BunnyMo injections are present.
    
    // PRIORITY CHECK 4: Continue with other detection methods
    if (entry.triggerReason || entry.matchedText || entry.contextUsed || entry.activationReason) {
        // console.log(`[BMT WORLD] ✅ SillyTavern provided trigger data!`);
        
        // Use SillyTavern's provided trigger information
        const sillyTavernReason = entry.triggerReason || entry.activationReason || 'SillyTavern activation';
        const matchedText = entry.matchedText || entry.contextUsed;
        
        analysis.triggerType = 'sillytavern_data';
        analysis.triggerReason = sillyTavernReason;
        analysis.triggerIcon = '🎯';
        analysis.triggerColor = '#00ff88';
        analysis.summary = `🎯 SILLYTAVERN - ${sillyTavernReason}`;
        analysis.details.explanation = `SillyTavern provided activation reason: ${sillyTavernReason}`;
        
        if (matchedText) {
            analysis.details.matchedText = matchedText;
            analysis.details.explanation += `\nMatched text: "${matchedText}"`;
        }
        
        analysis.isHighPriority = true;
        return analysis;
    }
    
    // PRIORITY CHECK 3: Look for cross-lorebook triggering 
    // IMPORTANT: Only apply this if the entry wasn't triggered by global context
    // (Global context should always take priority over inter-lorebook detection)
    if (currentEntries && currentEntries.length > 1) {
        // Check if this entry has any global context flags set
        const globalMatches = [];
        if (entry.matchPersonaDescription) globalMatches.push('Persona Description');
        if (entry.matchCharacterDescription) globalMatches.push('Character Description'); 
        if (entry.matchCharacterPersonality) globalMatches.push('Character Personality');
        if (entry.matchCharacterDepthPrompt) globalMatches.push('Character Depth Prompt');
        if (entry.matchScenario) globalMatches.push('Scenario');
        if (entry.matchCreatorNotes) globalMatches.push('Creator Notes');
        
        // Skip inter-lorebook detection if this entry has global context flags
        // Because global context detection should take priority (and we already handled it above)
        if (globalMatches.length === 0) {
            // Initialize variables outside the performance check
            let foundInLorebook = false;
            let triggeringEntry = null;
            
            // PERFORMANCE OPTIMIZATION: Limit expensive inter-lorebook detection
            // Only check if we have a reasonable number of entries to avoid O(n²) performance hits
            if (currentEntries && currentEntries.length <= 50) {
                // Check if this entry's keywords appear in other active entries' content
                const otherEntries = currentEntries.filter(e => e.uid !== entry.uid);
                
                if (entry.key && Array.isArray(entry.key)) {
                    for (const otherEntry of otherEntries) {
                        if (otherEntry.content) {
                            const otherContent = otherEntry.content.toLowerCase();
                            
                            for (const keyword of entry.key) {
                                if (keyword && otherContent.includes(keyword.toLowerCase())) {
                                    foundInLorebook = true;
                                    triggeringEntry = otherEntry;
                                    // console.log(`[BMT DEBUG] Found inter-lorebook trigger: "${keyword}" in "${otherEntry.comment}"`); // DISABLED - performance
                                    break;
                                }
                            }
                            
                            if (foundInLorebook) break;
                        }
                    }
                }
            } else {
                // Skip expensive inter-lorebook detection when too many entries are active
                // console.log(`[BMT DEBUG] Skipping inter-lorebook detection due to performance (${currentEntries.length} entries)`);
            }
            
            if (foundInLorebook && triggeringEntry) {
                // Check if this is a character entry
                const entryCategory = getEntryCategory(entry);
                const isCharacterEntry = (entryCategory === 'Characters' || entry.bunnymo_character || isCharacterLorebook(entry));
                
                if (isCharacterEntry) {
                    // This is a character entry triggered by another entry
                    analysis.triggerType = 'character_via_lorebook';
                    analysis.triggerReason = 'Character Entry Triggered by Another Entry';
                    analysis.triggerIcon = '👤';
                    analysis.triggerColor = '#4169E1';
                    analysis.summary = `👤 CHARACTER - Triggered by "${triggeringEntry.comment || triggeringEntry.key?.[0] || 'Unknown entry'}"`;
                    analysis.details.explanation = `This character entry was triggered by keywords found in another active entry: "${triggeringEntry.comment || triggeringEntry.key?.[0] || 'Unknown entry'}"`;
                } else {
                    // This is truly an inter-lorebook trigger for a non-character entry
                    analysis.triggerType = 'inter_lorebook';
                    analysis.triggerReason = 'Triggered by Another Lorebook Entry';
                    analysis.triggerIcon = '🔄';
                    analysis.triggerColor = '#FF8C00';
                    analysis.summary = `🔄 INTER-LOREBOOK - Triggered by "${triggeringEntry.comment || triggeringEntry.key?.[0] || 'Unknown entry'}"`;
                    analysis.details.explanation = `This entry was triggered by keywords found in another active lorebook entry: "${triggeringEntry.comment || triggeringEntry.key?.[0] || 'Unknown entry'}"`;
                }
                
                analysis.details.triggeringEntry = triggeringEntry.comment || triggeringEntry.key?.[0] || triggeringEntry.uid;
                analysis.details.triggeringEntryContent = triggeringEntry.content;
                analysis.isHighPriority = true;
                return analysis;
            }
        } else {
            // console.log(`[BMT DEBUG] Skipping inter-lorebook detection for "${entry.comment}" because global context was already detected`);
        }
    }
    
    // FALLBACK: Check for special cases our reverse-engineering missed
    
    // 1. CONSTANT ENTRIES (always fire) - already handled above, but check again
    if (entry.constant === true) {
        analysis.triggerType = 'constant';
        analysis.triggerReason = 'Constant Entry - Always Active';
        analysis.triggerIcon = '🔵';
        analysis.triggerColor = '#4169E1';
        analysis.summary = '🔵 CONSTANT - Always fires regardless of keywords';
        analysis.isHighPriority = true;
        analysis.details.explanation = 'This entry is marked as constant and will always be activated during any generation, regardless of chat content or keywords.';
        return analysis;
    }
    
    // 2. VECTORIZED ENTRIES (semantic matching via vector extension) - already handled above
    if (entry.vectorized === true) {
        analysis.triggerType = 'vectorized';
        analysis.triggerReason = 'Vectorized Entry - Semantic Similarity';
        analysis.triggerIcon = '🔗';
        analysis.triggerColor = '#9966CC';
        analysis.summary = '🔗 VECTORIZED - Triggered by semantic similarity';
        analysis.isHighPriority = true;
        analysis.details.explanation = 'This entry was activated by the vectors extension using semantic similarity matching, not keyword matching.';
        return analysis;
    }
    
    // 3. STICKY ENTRIES (active from timed effects)
    if (entry.sticky && (entry.sticky > 0 || entry.stickyRemaining > 0)) {
        analysis.triggerType = 'sticky';
        analysis.triggerReason = 'Sticky Entry - Timed Activation';
        analysis.triggerIcon = '📌';
        analysis.triggerColor = '#FF6347';
        analysis.summary = '📌 STICKY - Active from previous trigger';
        analysis.isHighPriority = true;
        analysis.details.explanation = 'This entry is currently sticky and remains active from a previous trigger.';
        return analysis;
    }
    
    // 4. DECORATOR ACTIVATION
    if (entry.decorators && entry.decorators.includes('@@activate')) {
        analysis.triggerType = 'decorator_activate';
        analysis.triggerReason = '@@activate Decorator';
        analysis.triggerIcon = '⚡';
        analysis.triggerColor = '#FF4500';
        analysis.summary = '⚡ DECORATOR - @@activate forced activation';
        analysis.isHighPriority = true;
        analysis.details.explanation = 'Entry was force-activated by the @@activate decorator';
        return analysis;
    }

    // 3. DATA BANK RAG ACTIVATION (vectors extension databank)
    if (entry.source && entry.source === 'databank') {
        analysis.triggerType = 'databank';
        analysis.triggerReason = 'Data Bank RAG Retrieval';
        analysis.triggerIcon = '📚';
        analysis.triggerColor = '#2E8B57';
        analysis.summary = '📚 DATABANK - Retrieved from vector data bank';
        analysis.isHighPriority = true;
        analysis.details.explanation = 'This entry was activated by the vectors extension\'s Data Bank RAG system based on semantic similarity to attached files.';
        return analysis;
    }

    // 4. DECORATOR FORCED ACTIVATION
    if (entry.decorators && entry.decorators.includes('@@activate')) {
        analysis.triggerType = 'decorator';
        analysis.triggerReason = 'Decorator Forced - @@activate';
        analysis.triggerIcon = '⚡';
        analysis.triggerColor = '#FFD700';
        analysis.summary = '⚡ DECORATOR - Force activated with @@activate';
        analysis.isHighPriority = true;
        analysis.details.explanation = 'This entry contains the @@activate decorator which forces it to activate regardless of other conditions.';
        return analysis;
    }
    
    // 9. RECURSION/FEEDBACK LOOP DETECTION - DISABLED 
    // Note: This was causing false positives. Character names triggering from character descriptions
    // is normal and expected behavior, not dangerous recursion.

    // 9. GENERATION TYPE FILTERING
    if (Array.isArray(entry.triggers) && entry.triggers.length > 0) {
        analysis.details.generationTypes = entry.triggers;
        analysis.details.hasGenerationFilter = true;
        
        // Check if activated due to specific generation type
        if (generationType && entry.triggers.includes(generationType)) {
            analysis.triggerType = 'generation_type';
            analysis.triggerReason = `Generation Type Match: ${generationType}`;
            analysis.triggerIcon = '🎭';
            analysis.triggerColor = '#20B2AA';
            analysis.summary = `🎭 GEN_TYPE - Triggered by ${generationType} generation`;
            analysis.details.explanation = `This entry was activated because it's configured to trigger on '${generationType}' generations.`;
            return analysis;
        }
    }
    
    // 9. RECURSION-BASED ACTIVATION
    if (entry.delayUntilRecursion && entry.delayUntilRecursion > 0) {
        analysis.triggerType = 'recursion';
        analysis.triggerReason = 'Recursion Delayed Entry';
        analysis.triggerIcon = '🔄';
        analysis.triggerColor = '#FF8C00';
        analysis.summary = '🔄 RECURSION - Activated during recursive scan';
        analysis.details.recursionLevel = entry.delayUntilRecursion;
        analysis.details.explanation = `This entry is configured to only activate during recursion level ${entry.delayUntilRecursion}.`;
        return analysis;
    }

    // 12. KEYWORD MATCHING ANALYSIS (moved higher priority)
    // Check if entry has NO keywords (should be rare)
    if (!entry.key || !Array.isArray(entry.key) || entry.key.length === 0) {
        analysis.triggerType = 'no_keywords';
        analysis.triggerReason = 'No Keywords Defined';
        analysis.triggerIcon = '❌';
        analysis.triggerColor = '#FF6B6B';
        analysis.summary = '❌ NO KEYS - Entry has no keywords defined';
        analysis.details.explanation = 'This entry has no primary keywords defined, so it should not have activated through normal keyword matching.';
        return analysis;
    }
    
    // Detailed keyword matching analysis with crash protection
    let keywordAnalysis = { matchedKeys: [], triggeringMessages: [], lastMessageMatch: null };
    try {
        recentMessages.forEach((msg, index) => { // Use the exact number of messages provided (respects scan depth)
            if (!msg || !msg.mes || typeof msg.mes !== 'string') return;
            
            const messageContent = msg.mes.toLowerCase();
            const matchedKeysInMsg = [];
            
            // Primary keywords with safety limits
            if (entry.key && Array.isArray(entry.key)) {
                entry.key.slice(0, 20).forEach(key => { // Limit to 20 keys max
                    try {
                        if (typeof key === 'string' && key.length > 0 && key.length < 500) { // Reasonable length limits
                            // Handle regex patterns with safety
                            if (key.startsWith('/') && (key.endsWith('/') || key.includes('/g') || key.includes('/i'))) {
                                try {
                                    const parts = key.split('/');
                                    const pattern = parts[1];
                                    const flags = parts[2] || 'gi';
                                    
                                    // Safety check for dangerous patterns
                                    if (pattern && pattern.length < 200 && !pattern.includes('(.*)*') && !pattern.includes('(.+)+')) {
                                        const regex = new RegExp(pattern, flags);
                                        if (regex.test(messageContent)) {
                                            const matches = [];
                                            const matchAll = messageContent.matchAll(regex);
                                            let count = 0;
                                            for (const match of matchAll) {
                                                if (count++ >= 50) break; // Prevent excessive matches
                                                matches.push(match[0]);
                                            }
                                            matchedKeysInMsg.push({ key: key, type: 'regex', matches: matches });
                                        }
                                    }
                                } catch (regexError) {
                                    // Treat as literal if regex fails
                                    if (messageContent.includes(key.toLowerCase())) {
                                        matchedKeysInMsg.push({ key: key, type: 'literal', matches: [key] });
                                    }
                                }
                            } else {
                                // Literal string matching
                                if (messageContent.includes(key.toLowerCase())) {
                                    matchedKeysInMsg.push({ key: key, type: 'literal', matches: [key] });
                                }
                            }
                        }
                    } catch (keyError) {
                        console.warn('[BMT WORLD] Error processing key:', key, keyError);
                    }
                });
            }
            
            if (matchedKeysInMsg.length > 0) {
                const messageData = {
                    sender: msg.name === 'user' ? 'user' : msg.name || 'Character',
                    messageIndex: chat.length - recentMessages.length + index, // Calculate position from end of chat
                    isLastMessage: index === 0, // Most recent message (first in array due to slice ordering)
                    matchedKeys: matchedKeysInMsg,
                    preview: messageContent.substring(0, 200),
                    isSystem: !!msg.is_system,
                    fullContent: msg.mes,
                    scanDepthUsed: recentMessages.length // Track what scan depth was actually analyzed
                };
                
                keywordAnalysis.triggeringMessages.push(messageData);
                keywordAnalysis.matchedKeys = keywordAnalysis.matchedKeys.concat(matchedKeysInMsg);
                
                if (index === 0) { // Most recent message
                    keywordAnalysis.lastMessageMatch = messageData;
                }
            }
        });
    } catch (analysisError) {
        console.warn('[BMT WORLD] Error in keyword analysis:', analysisError);
    }
    
    // Debug logging for keyword analysis (DISABLED - performance)
    // console.log(`[BMT DEBUG] Keyword analysis for "${entry.comment}":`, {
    //     hasKeys: !!(entry.key && entry.key.length > 0),
    //     keyCount: entry.key ? entry.key.length : 0,
    //     firstFewKeys: entry.key ? entry.key.slice(0, 3) : [],
    //     matchedKeysFound: keywordAnalysis.matchedKeys.length,
    //     triggeringMessagesFound: keywordAnalysis.triggeringMessages.length,
    //     result: keywordAnalysis.matchedKeys.length > 0 ? 'WILL_TRIGGER' : 'NO_MATCHES'
    // });
    
    // If keywords were found, return keyword analysis
    if (keywordAnalysis.matchedKeys.length > 0) {
        analysis.triggerType = 'keyword';
        analysis.triggerReason = 'Keyword Matching';
        analysis.triggerIcon = '🟢';
        analysis.triggerColor = '#32CD32';
        
        if (keywordAnalysis.lastMessageMatch) {
            analysis.summary = `🎯 KEYWORD - Last message from ${keywordAnalysis.lastMessageMatch.sender}`;
        } else {
            analysis.summary = `🟢 KEYWORD - ${keywordAnalysis.triggeringMessages.length} matching message(s)`;
        }
        
        const scanDepthUsed = recentMessages.length;
        analysis.details.explanation = `This entry was activated through keyword matching. ${keywordAnalysis.matchedKeys.length} unique keyword(s) were found in ${keywordAnalysis.triggeringMessages.length} message(s) within the last ${scanDepthUsed} message(s) (scanDepth: ${scanDepthUsed}).`;
        analysis.details.scanDepthAnalyzed = scanDepthUsed;
        analysis.matchedKeys = keywordAnalysis.matchedKeys;
        analysis.triggeringMessages = keywordAnalysis.triggeringMessages;
        analysis.lastMessageMatch = keywordAnalysis.lastMessageMatch;
        return analysis;
    }

    // If we reach here, no keyword matches found - show fallback analysis
    analysis.triggerType = 'unknown';
    analysis.triggerReason = 'Activation Method Unknown';
    analysis.triggerIcon = '❓';
    analysis.triggerColor = '#999999';
    analysis.summary = '❓ UNKNOWN - Could not determine activation reason';
    analysis.details.explanation = 'Could not determine why this entry was activated. It may be triggered by advanced ST mechanisms not yet supported by the analysis system.';
    
    // Add configuration details
    if (entry.cooldown && entry.cooldown > 0) {
        analysis.details.cooldown = entry.cooldown;
        analysis.details.hasCooldown = true;
    }
    if (entry.delay && entry.delay > 0) {
        analysis.details.delay = entry.delay;
        analysis.details.hasDelay = true;
    }
    
    return analysis;
};

const createBunnyMoWorldInfo = () => {
    logSeq('Creating sleek BunnyMoWorldInfo interface');
    
    // Minimal trigger button matching original design exactly
    const trigger = document.createElement('div');
    trigger.classList.add('bmwi-trigger', 'fa-solid', 'fa-fw', 'fa-carrot');
    trigger.title = 'BunnyMo World Info\\n---\\nright click for options';
    trigger.addEventListener('click', () => {
        panel.classList.toggle('bmwi-active');
        logSeq('Panel toggled');
    });
    trigger.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        configPanel.classList.toggle('bmwi-active');
        logSeq('Config panel toggled');
    });
    document.body.append(trigger);
    
    // Main panel - starts hidden, shows on click only
    const panel = document.createElement('div');
    panel.classList.add('bmwi-panel');
    document.body.append(panel);
    
    // Configuration panel - clean and minimal
    const configPanel = document.createElement('div');
    configPanel.classList.add('bmwi-config-panel');
    
    // Simple configuration options
    const configs = [
        { id: 'group', label: 'Group by category', default: true },
        { id: 'order', label: 'Show in order', default: true },
        { id: 'tags', label: 'Show BunnyMo tags', default: true },
        { id: 'compact', label: 'Compact display', default: false },
        { id: 'debug', label: '🔍 Debug triggers', default: false }
    ];
    
    configs.forEach(config => {
        const row = document.createElement('label');
        row.classList.add('bmwi-config-row');
        row.title = config.label;
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = extension_settings.bunnyMoWorldInfo?.[config.id] ?? config.default;
        checkbox.addEventListener('click', () => {
            if (!extension_settings.bunnyMoWorldInfo) {
                extension_settings.bunnyMoWorldInfo = {};
            }
            extension_settings.bunnyMoWorldInfo[config.id] = checkbox.checked;
            updatePanel(currentEntries);
            saveSettingsDebounced();
        });
        
        const label = document.createElement('div');
        label.textContent = config.label;
        
        row.append(checkbox, label);
        configPanel.append(row);
    });
    
    // Add close functionality to config panel
    configPanel.addEventListener('click', (evt) => {
        evt.stopPropagation();
    });
    
    // Click outside to close config panel
    document.addEventListener('click', (evt) => {
        // Close config panel when clicking outside
        if (!configPanel.contains(evt.target) && !trigger.contains(evt.target)) {
            configPanel.classList.remove('bmwi-active');
        }
        
        // Close main panel when clicking outside (collapse to icon)
        if (!panel.contains(evt.target) && !trigger.contains(evt.target)) {
            panel.classList.remove('bmwi-active');
        }
    });
    
    // ESC key to close both panels
    document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape') {
            if (configPanel.classList.contains('bmwi-active')) {
                configPanel.classList.remove('bmwi-active');
            } else if (panel.classList.contains('bmwi-active')) {
                panel.classList.remove('bmwi-active');
            }
        }
    });
    
    document.body.append(configPanel);
    
    // Badge management
    let count = -1;
    const updateBadge = async (newEntries) => {
        if (count != newEntries.length) {
            if (newEntries.length == 0) {
                trigger.classList.add('bmwi-badge-out');
                await delay(510);
                trigger.setAttribute('data-bmwi-count', newEntries.length.toString());
                trigger.classList.remove('bmwi-badge-out');
            } else if (count == 0) {
                trigger.classList.add('bmwi-badge-in');
                trigger.setAttribute('data-bmwi-count', newEntries.length.toString());
                await delay(510);
                trigger.classList.remove('bmwi-badge-in');
            } else {
                trigger.setAttribute('data-bmwi-count', newEntries.length.toString());
                trigger.classList.add('bmwi-badge-bounce');
                await delay(1010);
                trigger.classList.remove('bmwi-badge-bounce');
            }
            count = newEntries.length;
        }
    };
    
    // COMPLETELY REBUILT panel updates - clean, readable, functional
    const updatePanel = (entryList, newChat = false) => {
        const settings = extension_settings.bunnyMoWorldInfo || {};
        const isGrouped = settings.group ?? true;
        const showTags = settings.tags ?? true;
        
        // Clear panel and create header + content structure
        panel.innerHTML = '';
        
        // Apply debug mode styling to panel
        if (settings.debug) {
            panel.classList.add('bmwi-debug-mode');
        } else {
            panel.classList.remove('bmwi-debug-mode');
        }
        
        // Create header with title and controls
        const header = document.createElement('div');
        header.classList.add('bmwi-header');
        
        const headerTitle = document.createElement('div');
        headerTitle.classList.add('bmwi-header-title');
        headerTitle.innerHTML = '🥕 BunnyMo World Info';
        
        const headerControls = document.createElement('div');
        headerControls.classList.add('bmwi-header-controls');
        
        // Debug toggle in header - TRIGGER ANALYSIS SYSTEM
        const debugToggle = document.createElement('button');
        debugToggle.classList.add('bmwi-control-btn');
        debugToggle.textContent = '🔍 Show Triggers';
        debugToggle.title = '🔍 TRIGGER ANALYSIS MODE\n\nTurning this ON shows:\n• WHY each entry activated\n• WHICH messages triggered it\n• HOW keywords were matched\n• CLICK entries to highlight in chat\n\nThis is the complex detection system!';
        if (settings.debug) {
            debugToggle.classList.add('active');
            debugToggle.textContent = '🔍 TRIGGERS ON';
            debugToggle.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
            debugToggle.style.color = 'white';
        }
        debugToggle.addEventListener('click', (evt) => {
            evt.stopPropagation();
            if (!extension_settings.bunnyMoWorldInfo) {
                extension_settings.bunnyMoWorldInfo = {};
            }
            extension_settings.bunnyMoWorldInfo.debug = !extension_settings.bunnyMoWorldInfo.debug;
            
            if (extension_settings.bunnyMoWorldInfo.debug) {
                debugToggle.classList.add('active');
                debugToggle.textContent = '🔍 TRIGGERS ON';
                debugToggle.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
                debugToggle.style.color = 'white';
            } else {
                debugToggle.classList.remove('active');
                debugToggle.textContent = '🔍 Show Triggers';
                debugToggle.style.background = '';
                debugToggle.style.color = '';
            }
            
            updatePanel(currentEntries);
            saveSettingsDebounced();
        });
        
        // Expand all button
        const expandAllBtn = document.createElement('button');
        expandAllBtn.classList.add('bmwi-control-btn');
        expandAllBtn.textContent = '📖';
        expandAllBtn.title = 'Expand all entries';
        expandAllBtn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            const allEntries = panel.querySelectorAll('.bmwi-entry');
            const hasCollapsed = Array.from(allEntries).some(entry => !entry.classList.contains('expanded'));
            
            allEntries.forEach(entry => {
                const expandBtn = entry.querySelector('.bmwi-entry-expand');
                if (hasCollapsed) {
                    entry.classList.add('expanded');
                    expandBtn.textContent = '▲';
                } else {
                    entry.classList.remove('expanded');
                    expandBtn.textContent = '▼';
                }
            });
            
            expandAllBtn.textContent = hasCollapsed ? '📕' : '📖';
            expandAllBtn.title = hasCollapsed ? 'Collapse all entries' : 'Expand all entries';
        });
        
        // Clear Highlights button
        const clearHighlightsBtn = document.createElement('button');
        clearHighlightsBtn.classList.add('bmwi-control-btn');
        clearHighlightsBtn.textContent = '🧹';
        clearHighlightsBtn.title = 'Clear all chat message highlights';
        clearHighlightsBtn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            clearChatHighlights();
            
            // Show confirmation
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #2196F3, #1976D2);
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                font-weight: bold;
                z-index: 50000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                animation: bmwi-notification-slide-in 0.3s ease-out;
            `;
            notification.textContent = '🧹 Chat highlights cleared!';
            document.body.appendChild(notification);
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 2000);
        });
        
        // Fullscreen button
        const fullscreenBtn = document.createElement('button');
        fullscreenBtn.classList.add('bmwi-control-btn');
        fullscreenBtn.textContent = '🔍📱';
        fullscreenBtn.title = 'Open fullscreen overlay (easier to read)';
        fullscreenBtn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            updateOverlay(currentEntries);
            overlay.classList.add('active');
        });
        
        // Category filter buttons - create before processing entries
        const processedEntries = entryList.map(entry => {
            const processed = { ...entry };
            processed.category = getEntryCategory(processed);
            return processed;
        });
        
        // Get all available categories
        const allCategories = [...new Set(processedEntries.map(entry => entry.category))];
        
        // Initialize active filter state if not exists
        if (!window.bmwiActiveFilter) {
            window.bmwiActiveFilter = 'All';
        }
        
        // Create category filters container first
        const categoryFilters = document.createElement('div');
        categoryFilters.classList.add('bmwi-category-filters');
        
        // Add "All" button first
        const allBtn = document.createElement('button');
        allBtn.classList.add('bmwi-control-btn', 'bmwi-category-filter');
        allBtn.textContent = `All (${processedEntries.length})`;
        allBtn.title = 'Show all entries';
        
        if (window.bmwiActiveFilter === 'All') {
            allBtn.classList.add('active');
        }
        
        allBtn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            
            // Update active filter
            window.bmwiActiveFilter = 'All';
            
            // Update button states
            categoryFilters.querySelectorAll('.bmwi-category-filter').forEach(btn => {
                btn.classList.remove('active');
            });
            allBtn.classList.add('active');
            
            // Re-render content with filter
            updatePanelContent(processedEntries, content);
        });
        
        categoryFilters.appendChild(allBtn);
        
        // Create category filter buttons and add directly to category filters container
        allCategories.forEach(categoryName => {
            const categoryBtn = document.createElement('button');
            categoryBtn.classList.add('bmwi-control-btn', 'bmwi-category-filter');
            const categoryCount = processedEntries.filter(e => e.category === categoryName).length;
            categoryBtn.textContent = `${categoryName} (${categoryCount})`;
            categoryBtn.title = `Show only ${categoryName} entries`;
            
            if (window.bmwiActiveFilter === categoryName) {
                categoryBtn.classList.add('active');
            }
            
            categoryBtn.addEventListener('click', (evt) => {
                evt.stopPropagation();
                
                // Update active filter
                window.bmwiActiveFilter = categoryName;
                
                // Update button states
                categoryFilters.querySelectorAll('.bmwi-category-filter').forEach(btn => {
                    btn.classList.remove('active');
                });
                categoryBtn.classList.add('active');
                
                // Re-render content with filter
                updatePanelContent(processedEntries, content);
            });
            
            categoryFilters.appendChild(categoryBtn);
        });
        
        // Create basic controls container  
        const basicControls = document.createElement('div');
        basicControls.classList.add('bmwi-basic-controls');
        
        basicControls.appendChild(debugToggle);
        basicControls.appendChild(expandAllBtn);
        basicControls.appendChild(clearHighlightsBtn);
        basicControls.appendChild(fullscreenBtn);
        
        // Create header row with title and basic controls
        const headerRow = document.createElement('div');
        headerRow.classList.add('bmwi-header-row');
        headerRow.appendChild(headerTitle);
        headerRow.appendChild(basicControls);
        
        
        // Organize header structure
        header.appendChild(headerRow);
        header.appendChild(categoryFilters);
        panel.appendChild(header);
        
        // Create content area
        const content = document.createElement('div');
        content.classList.add('bmwi-content');
        
        if (!entryList || entryList.length === 0) {
            content.innerHTML = '<div class="bmwi-no-entries">No active world info entries</div>';
            panel.appendChild(content);
            return;
        }
        
        // Initial content rendering with current filter
        updatePanelContent(processedEntries, content);
        panel.appendChild(content);
    };
    
    // Separate function to update panel content based on active filter
    const updatePanelContent = (processedEntries, content) => {
        const settings = extension_settings.bunnyMoWorldInfo || {};
        const isGrouped = settings.group ?? true;
        
        // Clear content
        content.innerHTML = '';
        
        // Filter entries based on active filter
        let filteredEntries = processedEntries;
        if (window.bmwiActiveFilter && window.bmwiActiveFilter !== 'All') {
            filteredEntries = processedEntries.filter(entry => entry.category === window.bmwiActiveFilter);
        }
        
        if (filteredEntries.length === 0) {
            content.innerHTML = '<div class="bmwi-no-entries">No entries in selected category</div>';
            return;
        }
        
        let grouped;
        if (isGrouped && window.bmwiActiveFilter === 'All') {
            grouped = Object.groupBy(filteredEntries, entry => entry.category);
        } else {
            // When filtering by specific category, don't group
            grouped = { [window.bmwiActiveFilter || 'Active Entries']: filteredEntries };
        }
        
        Object.entries(grouped).forEach(([categoryName, entries]) => {
            if (!entries || entries.length === 0) return;
            
            // Only show category header when showing "All" or when grouped
            if (window.bmwiActiveFilter === 'All' && isGrouped) {
                // Category header
                const categoryDiv = document.createElement('div');
                categoryDiv.classList.add('bmwi-category');
                categoryDiv.textContent = `${categoryName} (${entries.length})`;
                content.append(categoryDiv);
            }
            
            // Create entries using new structure
            entries.forEach(entry => {
                const entryDiv = document.createElement('div');
                entryDiv.classList.add('bmwi-entry');
                
                // Entry main section (always visible)
                const mainDiv = document.createElement('div');
                mainDiv.classList.add('bmwi-entry-main');
                
                // Entry info section
                const infoDiv = document.createElement('div');
                infoDiv.classList.add('bmwi-entry-info');
                
                // Entry title with metadata tooltip
                const titleDiv = document.createElement('div');
                titleDiv.classList.add('bmwi-entry-title');
                const entryName = entry.comment || entry.key?.join(', ') || 'Unnamed Entry';
                titleDiv.textContent = entryName;
                
                // Build comprehensive entry tooltip
                let entryTooltip = `📋 ENTRY: ${entryName}\n\n`;
                entryTooltip += `🌍 World: ${entry.world || 'Unknown'}\n`;
                entryTooltip += `🔑 Primary Keys: ${entry.key?.join(', ') || 'None'}\n`;
                if (entry.keysecondary && entry.keysecondary.length > 0) {
                    entryTooltip += `🔐 Secondary Keys: ${entry.keysecondary.join(', ')}\n`;
                }
                entryTooltip += `📍 Position: ${entry.position !== undefined ? entry.position : 'Default'}\n`;
                entryTooltip += `⬇️ Depth: ${entry.depth !== undefined ? entry.depth : 'Default'}\n`;
                const effectiveScanDepth = getEffectiveScanDepth(entry);
                entryTooltip += `🎰 Scan Depth: ${effectiveScanDepth}`;
                if (effectiveScanDepth !== (entry.scanDepth || 5)) {
                    entryTooltip += ` (Override: ${effectiveScanDepth}, Original: ${entry.scanDepth || 5})`;
                }
                entryTooltip += `\n`;
                if (entry.sticky) entryTooltip += `📌 Sticky: ${entry.sticky} turns\n`;
                if (entry.cooldown) entryTooltip += `❄️ Cooldown: ${entry.cooldown} turns\n`;
                entryTooltip += `\n📝 CONTENT PREVIEW:\n${(entry.content || 'No content available').substring(0, 200)}${entry.content && entry.content.length > 200 ? '...' : ''}`;
                
                titleDiv.title = entryTooltip;
                
                // Badges section
                const badgesDiv = document.createElement('div');
                badgesDiv.classList.add('bmwi-entry-badges');
                
                // Strategy badge with BunnyMo styling and detailed tooltip
                const strategyBadge = document.createElement('span');
                strategyBadge.classList.add('bmwi-entry-badge');
                const strategyType = getStrategy(entry);
                strategyBadge.textContent = strategy[strategyType] + ' ' + strategyType.toUpperCase();
                
                // Add detailed strategy tooltip
                let strategyTooltip = '';
                switch(strategyType) {
                    case 'bunnymo':
                        strategyTooltip = '🐰 BunnyMo Character Entry\n\nThis is a character entry managed by the BunnyMo system. It contains character-specific information and traits that are automatically activated when this character is relevant to the conversation.';
                        break;
                    case 'constant':
                        strategyTooltip = '🥕 Constant Entry\n\nThis entry is ALWAYS active regardless of keywords or context. It provides fundamental world information that should always be available to the AI during generation.';
                        break;
                    case 'vectorized':
                        strategyTooltip = '🔗 Vectorized Entry\n\nThis entry uses semantic similarity matching through the vectors extension. It activates based on conceptual relevance rather than exact keyword matches, using AI embeddings for more intelligent triggering.';
                        break;
                    case 'normal':
                        strategyTooltip = '🟢 Normal Entry\n\nThis is a standard keyword-triggered entry. It activates when its primary or secondary keywords are found in recent chat messages, following traditional WorldInfo matching rules.';
                        break;
                }
                strategyBadge.title = strategyTooltip;
                badgesDiv.appendChild(strategyBadge);
                
                // Add BunnyMo branding badge
                const bunnyMoBadge = document.createElement('span');
                bunnyMoBadge.classList.add('bmwi-entry-badge');
                bunnyMoBadge.textContent = '🥕 BunnyMo';
                bunnyMoBadge.title = 'Powered by BunnyMoTags - Enhanced WorldInfo with cute theming!';
                badgesDiv.appendChild(bunnyMoBadge);
                
                // Add "Highlight in Chat" button if we have debug info with triggering messages
                if (entry.debugInfo && entry.debugInfo.triggeringMessages && entry.debugInfo.triggeringMessages.length > 0) {
                    const highlightBadge = document.createElement('span');
                    highlightBadge.classList.add('bmwi-entry-badge', 'bmwi-highlight-badge');
                    highlightBadge.textContent = '🕵️ Find in Chat';
                    highlightBadge.title = 'Click to highlight the messages in chat that triggered this WorldInfo entry';
                    highlightBadge.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
                    highlightBadge.style.cursor = 'pointer';
                    highlightBadge.style.transition = 'all 0.2s ease';
                    
                    // Add hover effect
                    highlightBadge.addEventListener('mouseenter', function() {
                        this.style.background = 'linear-gradient(135deg, #45a049, #4CAF50)';
                        this.style.transform = 'scale(1.05)';
                    });
                    
                    highlightBadge.addEventListener('mouseleave', function() {
                        this.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
                        this.style.transform = 'scale(1)';
                    });
                    
                    // Add click handler to highlight messages in chat
                    highlightBadge.addEventListener('click', function(e) {
                        e.stopPropagation();
                        highlightTriggeringMessages(entry);
                    });
                    
                    badgesDiv.appendChild(highlightBadge);
                }
                
                // Debug badge with detailed explanation
                if (entry.debugInfo && settings.debug) {
                    const debugBadge = document.createElement('span');
                    debugBadge.classList.add('bmwi-entry-badge');
                    debugBadge.style.background = entry.debugInfo.triggerColor;
                    debugBadge.style.color = '#fff';
                    debugBadge.textContent = entry.debugInfo.triggerIcon + ' ' + entry.debugInfo.triggerType.toUpperCase();
                    
                    // Create comprehensive debug tooltip based on trigger type
                    let debugTooltip = `${entry.debugInfo.triggerIcon} ${entry.debugInfo.triggerReason}\n\n${entry.debugInfo.details.explanation || 'No detailed explanation available'}`;
                    
                    // Add type-specific details
                    switch(entry.debugInfo.triggerType) {
                        case 'constant':
                            debugTooltip += `\n\n⚙️ CONFIGURATION:\n• Always Active: YES\n• Ignores Keywords: YES\n• Ignores Context: YES`;
                            break;
                        case 'vectorized':
                            debugTooltip += `\n\n🔗 VECTOR DETAILS:\n• Matching Type: Semantic Similarity\n• Uses AI Embeddings: YES\n• Extension: Vectors`;
                            break;
                        case 'databank':
                            debugTooltip += `\n\n📚 DATABANK RAG:\n• Source: Vector Data Bank\n• Retrieval Method: Semantic Search\n• Based on: Attached Files`;
                            break;
                        case 'force_activate':
                        case 'force_exact':
                            debugTooltip += `\n\n🚀 FORCE ACTIVATION:\n• Triggered By: External System\n• Event: WORLDINFO_FORCE_ACTIVATE\n• Bypasses: All normal rules`;
                            break;
                        case 'decorator':
                            debugTooltip += `\n\n⚡ DECORATOR ACTIVATION:\n• Decorator: @@activate\n• Location: Entry Content\n• Bypasses: Keyword matching`;
                            break;
                        case 'min_activations':
                        case 'min_activations_exact':
                            debugTooltip += `\n\n📊 MINIMUM ACTIVATIONS:\n• Reason: Meet minimum WI count\n• System Setting: Minimum activations\n• Fallback: When not enough entries`;
                            break;
                        case 'group_scoring':
                        case 'group_scoring_exact':
                            if (entry.debugInfo.details.groupWeight) {
                                debugTooltip += `\n\n🎯 GROUP SCORING:\n• Weight: ${entry.debugInfo.details.groupWeight}\n• System: Group scoring algorithm\n• Based on: Relevance scoring`;
                            }
                            break;
                        case 'generation_type':
                            if (entry.debugInfo.details.generationTypes) {
                                debugTooltip += `\n\n🎭 GENERATION FILTER:\n• Allowed Types: ${entry.debugInfo.details.generationTypes.join(', ')}\n• Current Type: ${generationType}\n• Matched: YES`;
                            }
                            break;
                        case 'recursion':
                        case 'recursion_exact':
                            if (entry.debugInfo.details.recursionLevel) {
                                debugTooltip += `\n\n🔄 RECURSION:\n• Delay Level: ${entry.debugInfo.details.recursionLevel}\n• Triggers: During recursive scans\n• Parent Entry: ${entry.debugInfo.details.parentEntry || 'Unknown'}`;
                            }
                            break;
                        case 'recursion_danger':
                            debugTooltip += `\n\n🔄❌ RECURSION DANGER:\n• Risk Level: ${entry.debugInfo.details.recursionRisk || 'HIGH'}\n• Problem: Entry triggered by system message\n• Keywords: ${entry.debugInfo.details.systemMessageKeywords?.join(', ') || 'Unknown'}\n• Prevention: ${entry.debugInfo.details.preventionAdvice || 'Use more specific keywords'}`;
                            break;
                        case 'sticky':
                            if (entry.debugInfo.details.sticky) {
                                debugTooltip += `\n\n📌 STICKY PERSISTENCE:\n• Duration: ${entry.debugInfo.details.sticky} turns\n• Status: Currently persisting\n• Original Trigger: Previous activation`;
                            }
                            break;
                        case 'global_context':
                            if (entry.debugInfo.details.globalMatches) {
                                debugTooltip += `\n\n🌍 GLOBAL CONTEXT MATCHES:\n• ${entry.debugInfo.details.globalMatches.map(m => `• ${m}: MATCHED`).join('\n')}`;
                            }
                            break;
                        case 'selective_logic':
                            if (entry.debugInfo.details.hasSecondaryKeys) {
                                const logicTypes = ['AND_ANY', 'AND_ALL', 'NOT_ANY', 'NOT_ALL'];
                                const logicType = logicTypes[entry.debugInfo.details.selectiveLogic] || 'AND_ANY';
                                debugTooltip += `\n\n🧠 SELECTIVE LOGIC:\n• Logic Type: ${logicType}\n• Secondary Keys: ${entry.debugInfo.details.secondaryKeys.join(', ')}\n• Primary + Secondary: Combined matching`;
                            }
                            break;
                        case 'scan_depth':
                        case 'scan_depth_tracked':
                            if (entry.debugInfo.details.scanDepth || entry.debugInfo.details.depthReason) {
                                debugTooltip += `\n\n🎰 SCAN DEPTH:\n• Depth: ${entry.debugInfo.details.scanDepth || 'Custom'}\n• Reason: ${entry.debugInfo.details.depthReason || 'Custom depth scanning'}\n• Searches: Deeper in chat history`;
                            }
                            break;
                        case 'position':
                            if (entry.debugInfo.details.position !== undefined) {
                                debugTooltip += `\n\n📍 POSITION-BASED:\n• Position: ${entry.debugInfo.details.position}\n• Trigger: Based on insertion position\n• Order: Affects activation priority`;
                            }
                            break;
                        case 'external_inject':
                            debugTooltip += `\n\n💉 EXTERNAL INJECTION:\n• Source: Manual or Extension\n• Method: Direct injection\n• Comment: Contains inject/external/manual`;
                            break;
                        case 'old_message':
                            debugTooltip += `\n\n🕰️ OLD MESSAGE MATCH:\n• Location: Older chat history\n• Beyond: Recent 5 messages\n• Keywords: Found in historical messages`;
                            break;
                        case 'programmatic_exact':
                            if (entry.debugInfo.details.progSource) {
                                debugTooltip += `\n\n🚀 PROGRAMMATIC:\n• Source: ${entry.debugInfo.details.progSource}\n• Type: ${entry.debugInfo.details.progType || 'Unknown'}\n• Method: API/Event activation`;
                            }
                            break;
                        case 'no-keys':
                            debugTooltip += `\n\n❌ NO KEYWORDS:\n• Primary Keys: None defined\n• Secondary Keys: ${entry.keysecondary?.length ? entry.keysecondary.join(', ') : 'None'}\n• Problem: Should not have activated`;
                            break;
                        case 'system_error':
                            if (entry.debugInfo.details.debugInfo) {
                                debugTooltip += `\n\n❌ TRACKING ERROR:\n• System: Failed to identify trigger\n• Debug Info: ${Object.entries(entry.debugInfo.details.debugInfo).map(([k,v]) => `${k}: ${v}`).join(', ')}\n• Action: Report this bug`;
                            }
                            break;
                        case 'keyword':
                            // Standard keyword matching - add message details
                            break;
                    }
                    
                    // Add triggering messages for keyword-based entries
                    if (entry.debugInfo.triggeringMessages && entry.debugInfo.triggeringMessages.length > 0) {
                        const scanDepthUsed = entry.debugInfo.details.scanDepthAnalyzed || 'Unknown';
                        debugTooltip += `\n\n📨 TRIGGERED BY ${entry.debugInfo.triggeringMessages.length} MESSAGE(S) (Scan Depth: ${scanDepthUsed}):`;
                        entry.debugInfo.triggeringMessages.forEach((msg, idx) => {
                            if (idx < 3) { // Show first 3 in tooltip
                                const senderType = msg.isSystem ? '[SYSTEM]' : (msg.sender === 'user' || msg.sender.toLowerCase().includes('user')) ? '[USER]' : '[AI]';
                                debugTooltip += `\n\n${senderType} ${msg.sender}${msg.isLastMessage ? ' [LAST MESSAGE]' : ''}:\n"${msg.preview}"\nMatched Keywords: ${msg.matchedKeys.map(k => `${k.key || k} (${k.type || 'literal'})`).join(', ')}`;
                            }
                        });
                        if (entry.debugInfo.triggeringMessages.length > 3) {
                            debugTooltip += `\n\n... and ${entry.debugInfo.triggeringMessages.length - 3} more messages`;
                        }
                    }
                    
                    // Add secondary key details
                    if (entry.debugInfo.details.hasSecondaryKeys && entry.debugInfo.triggerType !== 'selective_logic') {
                        const logicTypes = ['AND_ANY', 'AND_ALL', 'NOT_ANY', 'NOT_ALL'];
                        const logicType = logicTypes[entry.debugInfo.details.selectiveLogic] || 'AND_ANY';
                        debugTooltip += `\n\n🔐 SECONDARY KEYS:\n• Logic: ${logicType}\n• Keys: ${entry.debugInfo.details.secondaryKeys.join(', ')}`;
                    }
                    
                    debugBadge.title = debugTooltip;
                    badgesDiv.appendChild(debugBadge);
                }
                
                // Content preview - adjust length based on mode
                const previewDiv = document.createElement('div');
                previewDiv.classList.add('bmwi-entry-preview');
                const previewLength = settings.debug ? 300 : 80;
                const contentPreview = (entry.content || 'No content available').substring(0, previewLength);
                previewDiv.textContent = contentPreview + (entry.content && entry.content.length > previewLength ? '...' : '');
                
                // Expand button
                const expandBtn = document.createElement('div');
                expandBtn.classList.add('bmwi-entry-expand');
                expandBtn.textContent = '▼';
                expandBtn.title = 'Click to expand details';
                
                // Create title and expand button row
                const titleRow = document.createElement('div');
                titleRow.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; width: 100%;';
                titleRow.appendChild(titleDiv);
                titleRow.appendChild(expandBtn);
                
                // Build main section with vertical layout
                mainDiv.appendChild(titleRow);
                mainDiv.appendChild(badgesDiv);
                mainDiv.appendChild(previewDiv);
                
                // Entry details section (expandable)
                const detailsDiv = document.createElement('div');
                detailsDiv.classList.add('bmwi-entry-details');
                
                // Full content section
                const contentSection = document.createElement('div');
                contentSection.classList.add('bmwi-details-section');
                
                const contentTitle = document.createElement('div');
                contentTitle.classList.add('bmwi-details-title');
                contentTitle.innerHTML = '📝 Full Content';
                
                const contentContent = document.createElement('div');
                contentContent.classList.add('bmwi-details-content');
                contentContent.textContent = entry.content || 'No content available';
                
                contentSection.appendChild(contentTitle);
                contentSection.appendChild(contentContent);
                detailsDiv.appendChild(contentSection);
                
                // Entry metadata section
                const metaSection = document.createElement('div');
                metaSection.classList.add('bmwi-details-section');
                
                const metaTitle = document.createElement('div');
                metaTitle.classList.add('bmwi-details-title');
                metaTitle.innerHTML = '🔧 Entry Details';
                
                const metaContent = document.createElement('div');
                metaContent.classList.add('bmwi-details-content');
                metaContent.innerHTML = `
                    <strong>World:</strong> ${entry.world || 'Unknown'}<br>
                    <strong>Primary Keys:</strong> ${entry.key?.join(', ') || 'None'}<br>
                    ${entry.keysecondary ? `<strong>Secondary Keys:</strong> ${entry.keysecondary.join(', ')}<br>` : ''}
                    <strong>Position:</strong> ${entry.position !== undefined ? entry.position : 'Default'}<br>
                    <strong>Depth:</strong> ${entry.depth !== undefined ? entry.depth : 'Default'}
                `;
                
                metaSection.appendChild(metaTitle);
                metaSection.appendChild(metaContent);
                detailsDiv.appendChild(metaSection);
                
                // Debug section if available
                if (entry.debugInfo && settings.debug) {
                    const debugSection = document.createElement('div');
                    debugSection.classList.add('bmwi-details-section');
                    
                    const debugTitle = document.createElement('div');
                    debugTitle.classList.add('bmwi-details-title');
                    debugTitle.innerHTML = '🔍 Debug Information';
                    
                    const debugContent = document.createElement('div');
                    debugContent.classList.add('bmwi-debug-details');
                    
                    // Build comprehensive debug tooltip for main section
                    let mainDebugTooltip = `${entry.debugInfo.triggerReason}\n\nDETAILS:\n${entry.debugInfo.details.explanation || 'No explanation available'}`;
                    
                    if (entry.debugInfo.details.debugInfo) {
                        mainDebugTooltip += `\n\nDEBUG DATA:\n${Object.entries(entry.debugInfo.details.debugInfo).map(([k,v]) => `${k}: ${v}`).join('\n')}`;
                    }
                    
                    let debugHtml = `
                        <div class="bmwi-debug-section">
                            <div class="bmwi-debug-section-title" style="color: ${entry.debugInfo.triggerColor}; cursor: help;" title="${mainDebugTooltip.replace(/"/g, '&quot;')}">
                                ${entry.debugInfo.triggerIcon} ${entry.debugInfo.summary}
                            </div>
                            <div style="color: #ccc;">
                                ${entry.debugInfo.details.explanation || 'No detailed explanation available'}
                            </div>
                        </div>
                    `;
                    
                    if (entry.debugInfo.triggeringMessages && entry.debugInfo.triggeringMessages.length > 0) {
                        debugHtml += `
                            <div class="bmwi-debug-section">
                                <div class="bmwi-debug-section-title">📨 Triggering Messages:</div>
                                <div class="bmwi-debug-messages">
                        `;
                        
                        entry.debugInfo.triggeringMessages.forEach((msg, msgIdx) => {
                            // Better sender identification using actual character info
                            let senderType, displayName;
                            if (msg.isSystem) {
                                senderType = 'System';
                                displayName = 'System';
                            } else if (msg.sender === 'user' || msg.sender === 'You' || msg.sender.toLowerCase().includes('user')) {
                                senderType = 'User'; 
                                displayName = 'User';
                            } else {
                                // Use the actual character card name from the message
                                senderType = msg.sender; // This is the actual character name from SillyTavern
                                displayName = msg.sender; // Display the real character name (Atsu, etc.)
                            }
                            
                            const fullMessageTooltip = `${senderType}\n\nFULL MESSAGE:\n"${msg.fullContent || msg.preview}"\n\nMATCHED KEYWORDS:\n${msg.matchedKeys.map(k => `• ${k.key || k} (${k.type || 'literal'})`).join('\n')}\n\nMESSAGE TYPE: ${msg.isSystem ? 'System Message' : msg.sender === 'user' ? 'User Input' : 'Character Response'}\nPOSITION: Message ${msg.messageIndex}${msg.isLastMessage ? ' (Most Recent)' : ''}`;
                            
                            // CLEAR TRIGGER ANALYSIS - Show exactly what matched
                            const matchedKeywordsText = msg.matchedKeys.map(k => {
                                const keyText = k.key || k;
                                const keyType = k.type || 'literal';
                                return `"${keyText}" (${keyType})`;
                            }).join(', ');
                            
                            debugHtml += `
                                <div style="background: rgba(0, 0, 0, 0.2); padding: 12px; margin: 8px 0; border-radius: 8px; border-left: 3px solid #00ff88;">
                                    <div style="font-weight: bold; color: #00ff88; margin-bottom: 8px; font-size: 14px;">
                                        🎯 TRIGGERED BY: ${displayName}${msg.isLastMessage ? ' [LATEST MESSAGE]' : ` [${msg.messageIndex} messages ago]`}
                                    </div>
                                    
                                    <div style="background: rgba(0, 0, 0, 0.3); padding: 10px; border-radius: 6px; margin: 8px 0;">
                                        <div style="color: #ff6b35; font-weight: bold; margin-bottom: 4px;">📝 MESSAGE CONTENT:</div>
                                        <div style="color: #ddd; font-style: italic; line-height: 1.4;">
                                            "${msg.fullContent || msg.preview}"
                                        </div>
                                    </div>
                                    
                                    <div style="background: rgba(255, 107, 53, 0.1); padding: 8px; border-radius: 6px; border: 1px solid rgba(255, 107, 53, 0.3);">
                                        <div style="color: #ff6b35; font-weight: bold; margin-bottom: 4px;">🔑 MATCHED KEYWORDS:</div>
                                        <div style="color: #ffcc00; font-weight: 500;">
                                            ${matchedKeywordsText}
                                        </div>
                                    </div>
                                    
                                    <div style="margin-top: 8px; font-size: 12px; color: #888;">
                                        Sender: ${msg.isSystem ? 'System' : msg.sender === 'user' ? 'User' : 'Character'} • 
                                        Position: ${msg.isLastMessage ? 'Most Recent' : `${msg.messageIndex} back`}
                                    </div>
                                </div>
                            `;
                        });
                        
                        debugHtml += `
                                </div>
                            </div>
                        `;
                    }
                    
                    debugContent.innerHTML = debugHtml;
                    debugSection.appendChild(debugTitle);
                    debugSection.appendChild(debugContent);
                    detailsDiv.appendChild(debugSection);
                }
                
                // Add expand functionality - toggle entry expansion within panel
                mainDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isExpanded = entryDiv.classList.toggle('expanded');
                    expandBtn.textContent = isExpanded ? '▲' : '▼';
                });
                
                // Build complete entry
                entryDiv.appendChild(mainDiv);
                entryDiv.appendChild(detailsDiv);
                
                content.appendChild(entryDiv);
            });
        });
    };
    
    // Full-screen overlay for eye strain prevention
    const overlay = document.createElement('div');
    overlay.classList.add('bmwi-overlay');
    
    const overlayContent = document.createElement('div');
    overlayContent.classList.add('bmwi-overlay-content');
    
    const overlayHeader = document.createElement('div');
    overlayHeader.classList.add('bmwi-overlay-header');
    
    const overlayTitle = document.createElement('div');
    overlayTitle.classList.add('bmwi-overlay-title');
    overlayTitle.innerHTML = '🐰 BunnyMo WorldInfo Debug Console';
    
    const overlayClose = document.createElement('button');
    overlayClose.classList.add('bmwi-overlay-close');
    overlayClose.innerHTML = '×';
    overlayClose.title = 'Close overlay (ESC)';
    overlayClose.addEventListener('click', () => {
        overlay.classList.remove('active');
    });
    
    const overlayDescription = document.createElement('div');
    overlayDescription.style.cssText = 'color: #ccc; margin-bottom: 1em;';
    overlayDescription.innerHTML = 'Large, easy-to-read view with comprehensive trigger analysis';
    
    overlayHeader.append(overlayTitle, overlayDescription);
    overlayContent.append(overlayHeader, overlayClose);
    
    const overlayEntries = document.createElement('div');
    overlayEntries.classList.add('bmwi-overlay-entries');
    overlayContent.append(overlayEntries);
    
    overlay.appendChild(overlayContent);
    document.body.appendChild(overlay);
    
    // ESC key to close overlay
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            overlay.classList.remove('active');
        }
    });
    
    // Update overlay content function
    const updateOverlay = (entries) => {
        const settings = extension_settings.bunnyMoWorldInfo || {};
        
        overlayEntries.innerHTML = '';
        
        if (!entries || entries.length === 0) {
            overlayEntries.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #999; font-size: 1.2em; padding: 2em;">No active world info entries</div>';
            return;
        }
        
        entries.forEach(entry => {
            const entryDiv = document.createElement('div');
            entryDiv.classList.add('bmwi-overlay-entry');
            
            const entryName = entry.comment || entry.key?.[0] || 'Unnamed Entry';
            const debugInfo = entry.debugInfo;
            
            let contentHtml = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1em;">
                    <h3 style="margin: 0; color: #FFA500; font-size: 1.2em;">${entryName}</h3>
                    ${debugInfo ? `<div style="background: ${debugInfo.triggerColor}; color: white; padding: 0.3em 0.8em; border-radius: 15px; font-size: 0.9em; font-weight: bold;">${debugInfo.triggerIcon} ${debugInfo.triggerType.toUpperCase()}</div>` : ''}
                </div>
                
                <div style="margin-bottom: 1em; padding: 0.8em; background: rgba(0,0,0,0.3); border-radius: 8px; border-left: 3px solid #FFA500;">
                    <strong>Content:</strong><br>
                    <div style="margin-top: 0.5em; line-height: 1.4;">${entry.content || 'No content'}</div>
                </div>
            `;
            
            if (debugInfo) {
                contentHtml += `
                    <div style="margin-bottom: 1em;">
                        <strong>🔍 Trigger Analysis:</strong><br>
                        <div style="margin-top: 0.5em; color: #ccc;">${debugInfo.summary}</div>
                        <div style="margin-top: 0.5em; font-size: 0.9em; color: #aaa;">${debugInfo.details.explanation || ''}</div>
                    </div>
                `;
                
                if (debugInfo.triggeringMessages && debugInfo.triggeringMessages.length > 0) {
                    const scanDepthUsed = debugInfo.details.scanDepthAnalyzed || 'Unknown';
                    contentHtml += `
                        <div style="margin-bottom: 1em;">
                            <strong>📨 Triggering Messages (${debugInfo.triggeringMessages.length}) - Scan Depth: ${scanDepthUsed}:</strong>
                        </div>
                    `;
                    
                    debugInfo.triggeringMessages.forEach((msg, idx) => {
                        if (idx < 3) { // Show first 3 messages in overlay
                            contentHtml += `
                                <div style="margin: 0.5em 0; padding: 0.8em; background: rgba(255,255,255,0.1); border-radius: 6px; border-left: 2px solid #4ecdc4;">
                                    <div style="font-weight: bold; color: #4ecdc4; margin-bottom: 0.3em;">${msg.sender}${msg.isLastMessage ? ' [LAST]' : ''}</div>
                                    <div style="font-size: 0.9em; color: #ddd; line-height: 1.3;">"${msg.preview}"</div>
                                    <div style="margin-top: 0.3em; font-size: 0.8em; color: #aaa;">Keywords: ${msg.matchedKeys.map(k => k.key || k).join(', ')}</div>
                                </div>
                            `;
                        }
                    });
                    
                    if (debugInfo.triggeringMessages.length > 3) {
                        contentHtml += `<div style="text-align: center; color: #999; font-style: italic;">... and ${debugInfo.triggeringMessages.length - 3} more messages</div>`;
                    }
                }
            }
            
            entryDiv.innerHTML = contentHtml;
            overlayEntries.appendChild(entryDiv);
        });
    };
    
    // Function to highlight triggering messages in chat
    const highlightTriggeringMessages = (entry) => {
        // Clear any existing highlights first
        clearChatHighlights();
        
        if (!entry.debugInfo || !entry.debugInfo.triggeringMessages) {
            console.warn('[BMT WORLD] No triggering message data available for highlighting');
            return;
        }
        
        const triggeringMessages = entry.debugInfo.triggeringMessages;
        let highlightCount = 0;
        
        // Get all message elements in chat
        const chatMessages = document.querySelectorAll('#chat .mes');
        
        triggeringMessages.forEach(msgInfo => {
            // Find the corresponding message element by content matching or position
            let targetMessage = null;
            
            // Try to find by message index first (most reliable)
            if (msgInfo.messageIndex !== undefined) {
                const chatLength = chatMessages.length;
                const messageFromEnd = chatLength - 1 - msgInfo.messageIndex;
                if (messageFromEnd >= 0 && messageFromEnd < chatLength) {
                    targetMessage = chatMessages[messageFromEnd];
                }
            }
            
            // Fallback: try to find by content matching
            if (!targetMessage && msgInfo.fullContent) {
                for (let i = 0; i < chatMessages.length; i++) {
                    const messageElement = chatMessages[i];
                    const messageText = messageElement.querySelector('.mes_text')?.textContent || '';
                    if (messageText.includes(msgInfo.fullContent.substring(0, 100))) {
                        targetMessage = messageElement;
                        break;
                    }
                }
            }
            
            if (targetMessage) {
                // Create highlight overlay
                const highlight = document.createElement('div');
                highlight.classList.add('bmwi-chat-highlight');
                highlight.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: linear-gradient(135deg, rgba(255, 165, 0, 0.2), rgba(255, 200, 50, 0.2));
                    border: 2px solid #FFA500;
                    border-radius: 8px;
                    pointer-events: none;
                    z-index: 10;
                    animation: bmwi-highlight-pulse 2s infinite;
                `;
                
                // Make sure the parent message is relatively positioned
                if (getComputedStyle(targetMessage).position === 'static') {
                    targetMessage.style.position = 'relative';
                }
                
                targetMessage.appendChild(highlight);
                
                // Highlight specific keywords in the message text
                const messageTextElement = targetMessage.querySelector('.mes_text');
                if (messageTextElement && msgInfo.matchedKeys) {
                    highlightKeywordsInMessage(messageTextElement, msgInfo.matchedKeys);
                }
                
                // Scroll to the first highlighted message
                if (highlightCount === 0) {
                    targetMessage.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center' 
                    });
                }
                
                highlightCount++;
            }
        });
        
        if (highlightCount > 0) {
            // Show success notification
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #4CAF50, #45a049);
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                font-weight: bold;
                z-index: 50000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                animation: bmwi-notification-slide-in 0.3s ease-out;
            `;
            notification.textContent = `🕵️ Found ${highlightCount} triggering message${highlightCount > 1 ? 's' : ''}!`;
            document.body.appendChild(notification);
            
            // Remove notification after 3 seconds
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 3000);
            
            // Auto-clear highlights after 10 seconds
            setTimeout(clearChatHighlights, 10000);
        } else {
            // Show error notification
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #f44336, #d32f2f);
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                font-weight: bold;
                z-index: 50000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            `;
            notification.textContent = '🔍 Could not locate triggering messages in current chat';
            document.body.appendChild(notification);
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 3000);
        }
    };
    
    // Helper function to highlight keywords within message text
    const highlightKeywordsInMessage = (messageElement, matchedKeys) => {
        if (!matchedKeys || matchedKeys.length === 0) return;
        
        let messageHTML = messageElement.innerHTML;
        
        matchedKeys.forEach(keyData => {
            const keyword = keyData.key || keyData;
            if (keyword && keyword.length > 0) {
                // Escape special regex characters
                const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(${escapedKeyword})`, 'gi');
                
                messageHTML = messageHTML.replace(regex, 
                    '<span class="bmwi-keyword-highlight" style="background: linear-gradient(135deg, #FFD700, #FFA500); color: #000; padding: 1px 4px; border-radius: 3px; font-weight: bold; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">$1</span>'
                );
            }
        });
        
        messageElement.innerHTML = messageHTML;
    };
    
    // Function to clear all chat highlights
    const clearChatHighlights = () => {
        // Remove highlight overlays
        const existingHighlights = document.querySelectorAll('.bmwi-chat-highlight');
        existingHighlights.forEach(highlight => highlight.remove());
        
        // Remove keyword highlights
        const keywordHighlights = document.querySelectorAll('.bmwi-keyword-highlight');
        keywordHighlights.forEach(highlight => {
            const parent = highlight.parentNode;
            parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
            parent.normalize(); // Merge adjacent text nodes
        });
    };
    
    
    return { trigger, panel, configPanel, updatePanel, updateBadge, overlay, updateOverlay, highlightTriggeringMessages, clearChatHighlights };
};

// Individual entry modal removed - using existing fullscreen overlay instead

let bunnyMoWorldInfoUI = null;

export function initBunnyMoWorldInfo(bunnyMoScannedCharacters) {
    console.log(`[BMT WORLD] 🚀 Initializing professional BunnyMoWorldInfo system`);
    console.log(`[BMT WORLD] Available event types:`, Object.keys(event_types));
    console.log(`[BMT WORLD] WORLD_INFO_ACTIVATED event type:`, event_types.WORLD_INFO_ACTIVATED);
    
    scannedCharacters = bunnyMoScannedCharacters;
    
    if (bunnyMoWorldInfoUI) return bunnyMoWorldInfoUI;
    
    bunnyMoWorldInfoUI = createBunnyMoWorldInfo();
    
    eventSource.on(event_types.GENERATION_STARTED, (genType) => {
        generationType = genType;
        activationTracker.reset(); // Reset tracking for new generation
        // console.log(`[BMT WORLD] 🎬 Generation started: ${genType}`); // DISABLED - performance
    });
    
    // Hook into WORLDINFO_FORCE_ACTIVATE to track programmatic activation
    eventSource.on(event_types.WORLDINFO_FORCE_ACTIVATE, (entries) => {
        entries.forEach(entry => {
            if (entry.uid) {
                activationTracker.markForceActivated(entry.uid, 'WORLDINFO_FORCE_ACTIVATE event');
                logSeq(`🚀 Force activation tracked: ${entry.uid}`);
            }
        });
    });
    
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, async (entryList) => {
        try {
            // console.log(`[BMT WORLD] ✅ WORLD_INFO_ACTIVATED event fired with ${entryList.length} entries`); // DISABLED - performance
            
            // DEBUG: Log what SillyTavern actually provides us
            if (entryList.length > 0) {
                // console.log(`[BMT WORLD] 🔍 DEBUG: Entry data structure from SillyTavern:`); // DISABLED - performance
                // const sampleEntry = entryList[0];
                // console.log(`[BMT WORLD] Sample entry properties: ${Object.keys(sampleEntry).join(', ')}`);
                // console.log(`[BMT WORLD] Full sample entry:`, sampleEntry);
                // console.log(`[BMT WORLD] Looking for trigger data in: triggerReason, matchedText, contextUsed, activationReason, triggerContext`);
                
                // Check ALL possible trigger data properties (DISABLED - performance)
                // const triggerDataCheck = {
                //     triggerReason: sampleEntry.triggerReason,
                //     matchedText: sampleEntry.matchedText,
                //     contextUsed: sampleEntry.contextUsed,
                //     activationReason: sampleEntry.activationReason,
                //     triggerContext: sampleEntry.triggerContext,
                //     matchedKeywords: sampleEntry.matchedKeywords,
                //     triggerSource: sampleEntry.triggerSource,
                //     activatedBy: sampleEntry.activatedBy
                // };
                // console.log(`[BMT WORLD] Trigger data check:`, triggerDataCheck); // DISABLED - performance
            }
            
            // Limit number of entries processed to prevent crashes
            const limitedEntries = Array.isArray(entryList) ? entryList.slice(0, 100) : [];
            
            // Add debug analysis if enabled
            const settings = extension_settings.bunnyMoWorldInfo || {};
            if (settings.debug && chat && Array.isArray(chat) && chat.length > 0) {
                // logSeq(`🔍 Debug mode: Analyzing triggers for ${limitedEntries.length} entries`); // DISABLED - performance
                
                limitedEntries.forEach((entry, index) => {
                    try {
                        if (entry && typeof entry === 'object') {
                            // Get the effective scan depth for this specific entry
                            const effectiveScanDepth = getEffectiveScanDepth(entry);
                            const recentMessages = chat.slice(-effectiveScanDepth);
                            
                            entry.debugInfo = analyzeTriggerSources(entry, recentMessages);
                            // logSeq(`🎯 "${entry.comment || entry.key?.[0] || `Entry ${index}`}" (scanDepth: ${effectiveScanDepth}): ${entry.debugInfo.summary}`); // DISABLED - performance
                        }
                    } catch (entryError) {
                        console.warn('[BMT WORLD] Error analyzing entry:', entry, entryError);
                    }
                });
            }
            
            currentEntries = limitedEntries;
            bunnyMoWorldInfoUI.updatePanel(limitedEntries, true);
            
        } catch (error) {
            console.error('[BMT WORLD] Critical error in WORLD_INFO_ACTIVATED handler:', error);
            // Fallback to safe state
            currentEntries = [];
            try {
                bunnyMoWorldInfoUI.panel.innerHTML = '<div class="bmwi-error">⚠️ Error loading entries</div>';
            } catch (uiError) {
                console.error('[BMT WORLD] UI update also failed:', uiError);
            }
        }
    });
    
    // Handle no entries case
    const originalDebug = console.debug;
    console.debug = function(...args) {
        if (args[0] === '[WI] Found 0 world lore entries. Sorted by strategy') {
            logSeq('No WI entries detected');
            bunnyMoWorldInfoUI.panel.innerHTML = '<div class="bmwi-no-entries">No active entries</div>';
            bunnyMoWorldInfoUI.updateBadge([]);
            currentEntries = [];
        }
        return originalDebug.apply(this, args);
    };
    
    logSeq('BunnyMoWorldInfo initialization complete');
    return bunnyMoWorldInfoUI;
}

export { logSeq as bunnyMoWorldInfoLog };