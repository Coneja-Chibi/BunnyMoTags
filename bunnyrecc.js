/**
 * BunnyRecc - Character Generation Module for BunnyMoTags
 * Inspired by WorldInfo Recommender but designed for BunnyMo's character creation workflow
 */

// Import necessary functions from SillyTavern core
import { world_names, loadWorldInfo } from '../../../world-info.js';
import { getContext } from '../../../extensions.js';
import { templateManager } from './templateManager.js';

// @ts-ignore
import { Handlebars } from '../../../../../lib.js';

export class BunnyRecc {
    constructor() {
        this.settings = this.getDefaultSettings();
        this.templates = {};
        this.activeSession = {};
        this.isInitialized = false;
        
        // BunnyMo pack integration
        this.availablePacks = [];
        this.activeTraitSelections = {};
        
        // Result persistence
        this.sessionKey = 'bunnyRecc_results';
        this.persistentResults = [];
    }

    loadSettings() {
        try {
            const context = getContext();
            if (context?.extensionSettings?.bunnyRecc) {
                this.settings = { ...this.settings, ...context.extensionSettings.bunnyRecc };
                console.log('🐰 BunnyRecc: Settings loaded successfully');
            } else {
                console.log('🐰 BunnyRecc: Using default settings');
            }
        } catch (error) {
            console.warn('🐰 BunnyRecc: Failed to load settings:', error);
        }
    }

    saveSettings() {
        try {
            const context = getContext();
            if (!context.extensionSettings) {
                context.extensionSettings = {};
            }
            context.extensionSettings.bunnyRecc = this.settings;
            context.saveSettingsDebounced();
            console.log('🐰 BunnyRecc: Settings saved successfully');
        } catch (error) {
            console.warn('🐰 BunnyRecc: Failed to save settings:', error);
        }
    }

    saveResultsSession() {
        try {
            const sessionData = {
                results: this.persistentResults,
                timestamp: Date.now()
            };
            localStorage.setItem(this.sessionKey, JSON.stringify(sessionData));
            console.log('🐰 BunnyRecc: Results session saved with', this.persistentResults.length, 'results');
        } catch (error) {
            console.warn('🐰 BunnyRecc: Failed to save results session:', error);
        }
    }

    loadResultsSession() {
        try {
            const saved = localStorage.getItem(this.sessionKey);
            if (saved) {
                const sessionData = JSON.parse(saved);
                this.persistentResults = sessionData.results || [];
                console.log('🐰 BunnyRecc: Loaded', this.persistentResults.length, 'previous results');
                return true;
            }
        } catch (error) {
            console.warn('🐰 BunnyRecc: Failed to load results session:', error);
            this.persistentResults = [];
        }
        return false;
    }

    displayExistingResults() {
        if (this.persistentResults && this.persistentResults.length > 0) {
            console.log('🐰 BunnyRecc: Displaying', this.persistentResults.length, 'existing results');
            
            const resultsDiv = document.getElementById('bunnyRecc_results');
            if (!resultsDiv) {
                console.warn('🐰 BunnyRecc: Results div not found, will display when available');
                return;
            }
            
            // Build accumulated results HTML
            let resultsHTML = '';
            this.persistentResults.forEach((result, index) => {
                const timestamp = new Date(result.timestamp).toLocaleString();
                const isLatest = index === this.persistentResults.length - 1;
                const formattedSheet = this.formatCharacterSheetForDisplay(result.characterSheet);
                
                resultsHTML += `
                    <div class="bunny-result-entry ${isLatest ? 'latest' : 'previous'}" style="margin-bottom: 30px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; padding: 15px;">
                        <div class="bunny-result-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid var(--SmartThemeBorderColor);">
                            <div class="bunny-result-info">
                                <h3 style="margin: 0;">✨ ${result.characterName}</h3>
                                <small style="opacity: 0.7;">${timestamp} ${isLatest ? '(Latest)' : ''}</small>
                            </div>
                            <div class="bunny-result-actions">
                                <button class="menu_button bunny-copy-btn" onclick="window.bunnyReccInstance.copyCharacterSheet('${encodeURIComponent(result.fullResponse)}')">
                                    📋 Copy
                                </button>
                            </div>
                        </div>
                        <div class="bunny-result-content">
                            <div class="bunny-character-sheet">
                                ${formattedSheet}
                            </div>
                            <div class="bunny-results-tags" style="margin-top: 15px;">
                                <h4>🏷️ BunnyTags (${result.tags.length}):</h4>
                                <div class="bunny-tags-list">
                                    ${result.tags.map(tag => `<span class="bunny-tag">${tag}</span>`).join('')}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            resultsDiv.innerHTML = resultsHTML;
            
            // Apply runtime style restoration for existing results
            setTimeout(() => this.applyTagVisibilityFixes(resultsDiv), 100);
        }
    }

    applyTagVisibilityFixes(resultsDiv) {
        console.log('🐰 BunnyRecc: Applying runtime tag visibility fixes...');
        
        // Force visibility of any hidden elements
        const hiddenElements = resultsDiv.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]');
        hiddenElements.forEach(el => {
            el.style.display = 'revert';
            el.style.visibility = 'visible';
            el.style.opacity = '1';
        });
        
        // Look for and restore any content that was replaced with asterisks
        const textElements = resultsDiv.querySelectorAll('*');
        textElements.forEach(node => {
            if (node.textContent && node.textContent.match(/^\*+$/) && node.children.length === 0) {
                console.log('🐰 BunnyRecc: Found potential hidden tag (asterisks):', node);
                // This is likely a hidden tag - mark it for investigation
                node.style.background = 'rgba(255, 165, 0, 0.3)';
                node.title = 'This element may contain hidden BunnyMo tags';
            }
        });
        
        // Force visibility of all bunny-tag elements
        const bunnyTags = resultsDiv.querySelectorAll('.bunny-tag, [class*="bunny"]');
        bunnyTags.forEach(tag => {
            tag.style.display = 'inline-block';
            tag.style.visibility = 'visible';
            tag.style.opacity = '1';
        });
        
        console.log('🐰 BunnyRecc: Runtime tag visibility fixes applied');
    }

    getDefaultSettings() {
        return {
            profileId: '',
            contextToSend: {
                bunnyMoDescription: true,
                messages: {
                    type: 'last',
                    last: 10
                },
                charCard: true,
                worldInfo: true
            },
            maxContextType: 'profile',
            maxContextValue: 8192,
            maxResponseToken: 2048,
            outputFormat: 'fullsheet', // 'fullsheet' | 'quicksheet'
            postToChat: false,
            selectedTraits: [],
            selectedLorebooks: []
        };
    }

    async initialize() {
        if (this.isInitialized) return;
        
        console.log('🐰 BunnyRecc: Initializing character generation module...');
        
        try {
            await this.loadTemplates();
            this.createCharacterGeneratorIcon();
            this.loadSettings();
            this.discoverBunnyMoPacks();
            this.isInitialized = true;
            
            console.log('✨ BunnyRecc: Initialization complete!');
        } catch (error) {
            console.error('🚫 BunnyRecc: Failed to initialize:', error);
        }
    }

    async loadTemplates() {
        // Templates are built directly in JavaScript - no external files needed
        this.templates.popup = 'Built in createPopupInterface()';
        this.templates.traitSelector = 'Built in setupTraitSelection()';
        console.log('🐰 BunnyRecc: Templates loaded (built-in JavaScript templates)');
    }


    createCharacterGeneratorIcon() {
        // Create BunnyRecc icons with bunny theming
        const iconHtml = `
            <div class="menu_button bunny-recc-icon interactable" 
                 title="🐰 BunnyRecc Character Generator">
                🐰
                <span class="bunny-recc-sparkle">✨</span>
            </div>
        `;

        // Target locations for the icon (similar to WREC but with our own touch)
        const targets = [
            document.querySelector('.form_create_bottom_buttons_block'),
            document.querySelector('#GroupFavDelOkBack'),
            document.querySelector('#rm_buttons_container') ?? 
            document.querySelector('#form_character_search_form')
        ];

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = iconHtml.trim();
        const iconTemplate = tempDiv.firstChild;

        targets.forEach((target, index) => {
            if (target) {
                const icon = iconTemplate.cloneNode(true);
                icon.classList.add(`bunny-recc-icon-${index}`);
                target.insertBefore(icon, target.firstChild);
                
                // Add click handler
                icon.addEventListener('click', () => {
                    console.log('🐰 BunnyRecc: Icon clicked, opening generator...');
                    this.openCharacterGeneratorPopup();
                });
            }
        });

        console.log('🐰 BunnyRecc: Character generator icons created');
    }

    async openCharacterGeneratorPopup() {
        console.log('🐰 BunnyRecc: Opening character generator...');
        
        // Create the popup content (restored original approach)
        const popupContent = `
            <style>
                /* SillyTavern popup integration - CRITICAL FIX */
                .popup-content:has(#bunnyReccPopup) {
                    overflow-y: auto;
                    height: 100%;
                }

                .popup-body:has(#bunnyReccPopup) {
                    overflow: visible;
                }
                
                /* BunnyRecc popup styling with theme fallbacks */
                #bunnyReccPopup {
                    display: flex;
                    flex-direction: column;
                    background-color: var(--SmartThemeBlurTintColor, rgba(20, 20, 20, 0.9));
                    color: var(--SmartThemeBodyColor, #ffffff);
                    min-height: 600px;
                    padding: 20px;
                }
                
                #bunnyReccPopup .flex-container {
                    display: flex;
                }
                
                #bunnyReccPopup .flex1 {
                    flex: 1;
                    min-width: 0;
                }
                
                #bunnyReccPopup .flexFlowColumn {
                    flex-direction: column;
                }
                
                /* Fix tab content - remove flex conflicts and SillyTavern CSS interference */
                .bunnyrecc-tab-content {
                    display: none !important;
                    width: 100%;
                    height: auto;
                    position: relative;
                }
                
                .bunnyrecc-tab-content.active {
                    display: block !important;
                }
                
                /* BunnyMo Style Config Panel - Fun but Functional */
                .bunnyrecc-tab-content.active .inline-drawer {
                    display: block !important;
                    background: transparent !important;
                    border: none !important;
                    padding: 0 !important;
                    margin: 0 !important;
                }
                
                .bunnyrecc-tab-content.active .inline-drawer-content {
                    display: block !important;
                    background: transparent !important;
                    padding: 15px !important;
                    margin: 0 !important;
                }
                
                /* BunnyMo themed sections with BunnyMo brand colors */
                .bunnyrecc-tab-content.active .range-block {
                    display: block !important;
                    background: var(--SmartThemeBlurTintColor) !important;
                    border: 2px solid rgba(255, 140, 105, 0.4) !important;
                    border-radius: 12px !important;
                    margin: 15px 0 !important;
                    padding: 18px !important;
                    position: relative !important;
                    transition: all 0.3s ease !important;
                }
                
                .bunnyrecc-tab-content.active .range-block::before {
                    content: "🐰" !important;
                    position: absolute !important;
                    top: -8px !important;
                    right: 15px !important;
                    background: var(--SmartThemeBlurTintColor) !important;
                    padding: 0 8px !important;
                    font-size: 16px !important;
                    opacity: 0.6 !important;
                }
                
                .bunnyrecc-tab-content.active .range-block:hover {
                    border-color: rgba(255, 140, 105, 0.6) !important;
                    transform: translateY(-2px) !important;
                    box-shadow: 0 4px 20px rgba(255, 140, 105, 0.15) !important;
                }
                
                .bunnyrecc-tab-content.active .range-block:hover::before {
                    opacity: 1 !important;
                }
                
                /* Typography with BunnyMo personality */
                .bunnyrecc-tab-content.active .range-block-title {
                    display: block !important;
                    color: rgba(255, 160, 122, 0.95) !important;
                    font-size: 1.1em !important;
                    font-weight: bold !important;
                    margin-bottom: 10px !important;
                    padding: 0 !important;
                    background: transparent !important;
                }
                
                .bunnyrecc-tab-content.active .toggle-description {
                    display: block !important;
                    color: var(--SmartThemeQuoteColor) !important;
                    font-size: 0.9em !important;
                    line-height: 1.4 !important;
                    margin: 8px 0 12px 0 !important;
                    padding: 0 !important;
                    background: transparent !important;
                    opacity: 0.8 !important;
                }
                
                /* Form inputs with BunnyMo theming */
                .bunnyrecc-tab-content.active select,
                .bunnyrecc-tab-content.active input[type="text"],
                .bunnyrecc-tab-content.active input[type="number"],
                .bunnyrecc-tab-content.active textarea,
                .bunnyrecc-tab-content.active input {
                    display: block !important;
                    width: 100% !important;
                    background: var(--SmartThemeBodyColor) !important;
                    color: var(--SmartThemeEmColor) !important;
                    border: 1px solid var(--SmartThemeBorderColor) !important;
                    border-radius: 6px !important;
                    padding: 10px 12px !important;
                    margin: 8px 0 !important;
                    font-size: 14px !important;
                    transition: all 0.2s ease !important;
                    box-sizing: border-box !important;
                }
                
                .bunnyrecc-tab-content.active select:focus,
                .bunnyrecc-tab-content.active input:focus,
                .bunnyrecc-tab-content.active textarea:focus {
                    outline: none !important;
                    border-color: rgba(255, 140, 105, 0.7) !important;
                    box-shadow: 0 0 0 2px rgba(255, 140, 105, 0.25) !important;
                }
                
                /* Checkbox styling with BunnyMo coral colors */
                .bunnyrecc-tab-content.active input[type="checkbox"],
                .bunnyrecc-tab-content.active input[type="radio"] {
                    width: auto !important;
                    margin: 0 8px 0 0 !important;
                    accent-color: #ff8c69 !important;
                }
                
                .bunnyrecc-tab-content.active label {
                    display: flex !important;
                    align-items: center !important;
                    color: var(--SmartThemeEmColor) !important;
                    cursor: pointer !important;
                    padding: 8px 0 !important;
                    transition: color 0.2s ease !important;
                }
                
                .bunnyrecc-tab-content.active label:hover {
                    color: rgba(255, 160, 122, 0.9) !important;
                }
                
                /* Range slider with BunnyMo coral accent */
                .bunnyrecc-tab-content.active input[type="range"] {
                    width: 100% !important;
                    margin: 10px 0 !important;
                    accent-color: #ff8c69 !important;
                }
                
                /* Styled range value display */
                .bunnyrecc-tab-content.active .range-block .text_pole {
                    background: rgba(255, 140, 105, 0.15) !important;
                    border: 1px solid rgba(255, 140, 105, 0.4) !important;
                    color: rgba(255, 160, 122, 0.95) !important;
                    text-align: center !important;
                    font-weight: bold !important;
                    margin-top: 10px !important;
                }
                
                /* BunnyMo styled buttons with coral theme */
                .bunnyrecc-tab-content.active button,
                .bunnyrecc-tab-content.active .menu_button {
                    display: inline-block !important;
                    background: linear-gradient(135deg, rgba(255, 140, 105, 0.2), rgba(255, 140, 105, 0.08)) !important;
                    color: rgba(255, 160, 122, 0.95) !important;
                    border: 1px solid rgba(255, 140, 105, 0.4) !important;
                    border-radius: 8px !important;
                    padding: 10px 18px !important;
                    margin: 8px 8px 8px 0 !important;
                    font-size: 14px !important;
                    font-weight: 500 !important;
                    cursor: pointer !important;
                    transition: all 0.2s ease !important;
                    box-sizing: border-box !important;
                }
                
                .bunnyrecc-tab-content.active button:hover,
                .bunnyrecc-tab-content.active .menu_button:hover {
                    background: linear-gradient(135deg, rgba(255, 140, 105, 0.3), rgba(255, 140, 105, 0.15)) !important;
                    border-color: rgba(255, 140, 105, 0.6) !important;
                    transform: translateY(-1px) !important;
                    box-shadow: 0 4px 12px rgba(255, 140, 105, 0.25) !important;
                }
                
                .bunnyrecc-tab-content.active button:active,
                .bunnyrecc-tab-content.active .menu_button:active {
                    transform: translateY(0px) !important;
                }
                
                /* Special styling for reset button */
                .bunnyrecc-tab-content.active button:last-of-type {
                    background: rgba(255, 255, 255, 0.05) !important;
                    color: rgba(255, 255, 255, 0.7) !important;
                    border-color: rgba(255, 255, 255, 0.2) !important;
                }
                
                .bunnyrecc-tab-content.active button:last-of-type:hover {
                    background: rgba(255, 255, 255, 0.1) !important;
                    color: rgba(255, 255, 255, 0.9) !important;
                    border-color: rgba(255, 255, 255, 0.3) !important;
                }
                
                #bunnyRecc_results {
                    overflow-y: auto;
                    min-height: 400px;
                }
            </style>
            
            <div id="bunnyReccPopup">
                <div class="justifyCenter">
                    <h2 style="margin-bottom: 20px;">🐰✨ BunnyRecc Character Generator</h2>
                    <p style="text-align: center; opacity: 0.8; margin-bottom: 20px;">Create amazing characters with BunnyMo intelligence</p>
                </div>
                
                <!-- Tab Navigation -->
                <div class="bunnyrecc-tabs" style="display: flex; margin-bottom: 20px; border-bottom: 1px solid var(--SmartThemeBorderColor);">
                    <button class="bunnyrecc-tab active" data-tab="generation" style="flex: 1; padding: 10px; background: none; border: none; color: var(--SmartThemeBodyColor); cursor: pointer; border-bottom: 2px solid #f0c674;">
                        🎭 Character Generation
                    </button>
                    <button class="bunnyrecc-tab" data-tab="config" style="flex: 1; padding: 10px; background: none; border: none; color: var(--SmartThemeBodyColor); cursor: pointer; border-bottom: 2px solid transparent; opacity: 0.7;">
                        ⚙️ Per-Chat Config
                    </button>
                </div>
                
                <!-- Tab Content Container -->
                <div class="bunnyrecc-tab-container" style="flex: 1; position: relative; overflow: hidden;">
                    <!-- Generation Tab Content -->
                    <div id="bunnyrecc-tab-generation" class="bunnyrecc-tab-content active">
                        <div class="flex-container flexFlowColumn">
                            <div class="flex-container" style="gap: 20px; align-items: flex-start;">
                                <div class="flex1 flexFlowColumn" style="gap: 15px;">
                                    ${this.createConnectionProfileSection()}
                                    ${this.createContextSelectionSection()}
                                    ${this.createTraitSelectionSection()}
                                    ${this.createPromptSection()}
                                </div>
                                
                                <div class="flex1">
                                    ${this.createResultsSection()}
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Per-Chat Config Tab Content -->
                    <div id="bunnyrecc-tab-config" class="bunnyrecc-tab-content">
                        ${this.createPerChatConfigSection()}
                    </div>
                </div>
            </div>
        `;
        
        // Use original popup call
        SillyTavern.getContext().callGenericPopup(popupContent, SillyTavern.getContext().POPUP_TYPE.DISPLAY, undefined, {
            large: true,
            wide: true,
        });

        // Load previous results from session
        this.loadResultsSession();
        
        // Initialize popup functionality with simple tab fix
        setTimeout(() => {
            this.initializePopupHandlers();
            this.displayExistingResults();
        }, 100);
    }



    createPerChatConfigSection() {
        console.log('🐰 BunnyRecc: DEBUG - createPerChatConfigSection() called');
        const content = `
            <div class="inline-drawer">
                <div class="inline-drawer-content">
                    <!-- Configuration Overview -->
                    <div class="range-block">
                        <div class="range-block-title">
                            <strong>📋 BunnyMo Configuration Override</strong>
                        </div>
                        <div class="toggle-description justifyLeft">
                            Configure BunnyMo behavior for specific contexts. Changes here only affect the current chat and don't modify your main BunnyMo extension settings.
                        </div>
                    </div>
                    
                    <!-- Configuration Scope Selection -->
                    <div class="range-block">
                        <div class="range-block-title">
                            <strong>Configuration Scope</strong>
                        </div>
                        <div class="toggle-description justifyLeft">
                            Choose whether to apply these settings to just this chat or all chats with this character.
                        </div>
                        <div class="floating_prompt_radio_group">
                            <label class="checkbox_label flexWrap alignItemsCenter" for="bunnymo_scope_chat">
                                <input type="radio" name="bunnymo_config_scope" value="chat" id="bunnymo_scope_chat" checked>
                                <span>This Chat Only</span>
                                <small class="flexBasis100p text_muted">
                                    Apply configuration only to this specific chat conversation
                                </small>
                            </label>
                            <label class="checkbox_label flexWrap alignItemsCenter" for="bunnymo_scope_character">
                                <input type="radio" name="bunnymo_config_scope" value="character" id="bunnymo_scope_character">
                                <span>This Character (All Chats)</span>
                                <small class="flexBasis100p text_muted">
                                    Apply configuration to all chats with this character
                                </small>
                            </label>
                        </div>
                    </div>

                    <!-- Lorebook Management -->
                    <div class="range-block">
                        <div class="range-block-title">
                            <strong>Lorebook Selection</strong>
                            <div class="fa-solid fa-circle-info opacity50p" title="Select which lorebooks BunnyRecc should use for trait extraction. These are separate from your main BunnyMo extension settings."></div>
                        </div>
                        <div class="toggle-description justifyLeft">
                            Configure character repositories and tag libraries for BunnyRecc.
                        </div>
                        
                        <!-- Search Input -->
                        <div class="flex-container marginBot5">
                            <input type="text" id="bunnyRecc_searchLorebooks" class="text_pole wide100p" placeholder="🔍 Search lorebooks...">
                        </div>

                        <!-- Lorebook List -->
                        <div id="bunnyRecc_lorebook_list" class="wide100p">
                            <!-- Lorebooks will be populated here -->
                        </div>
                    </div>

                    <!-- Scan Depth Override -->
                    <div class="range-block">
                        <div class="range-block-title">
                            <strong>🔍 Scan Depth Override</strong>
                            <div class="fa-solid fa-circle-info opacity50p" title="Scan depth controls how many recent messages BunnyMo analyzes when building character context. Higher values provide more context but use more tokens."></div>
                        </div>
                        <div class="toggle-description justifyLeft">
                            Override scan depth for all BunnyMo entries (1-50 messages).
                        </div>
                        
                        <div class="flex-container alignitemscenter marginTop5">
                            <input type="range" id="bunnyRecc_scan_depth" class="neo-range-slider flex1" min="1" max="50" value="10" step="1">
                            <input type="number" id="bunnyRecc_scan_depth_counter" class="neo-range-input" min="1" max="50" value="10" data-for="bunnyRecc_scan_depth">
                        </div>
                    </div>
                    
                    <!-- Action Buttons -->
                    <div class="flex-container justifyCenter gap10h5v marginTop10">
                        <button class="menu_button" id="bunnyRecc_save_config">
                            💾 Save Configuration
                        </button>
                        <button class="menu_button" id="bunnyRecc_reset_config">
                            🔄 Reset to Global
                        </button>
                    </div>
                    
                    <!-- Status Display -->
                    <div class="flex-container justifyCenter marginTop5">
                        <small class="text_muted" id="bunnyRecc_config_status">
                            🌐 Using global settings
                        </small>
                    </div>
                </div>
            </div>
        `;
        console.log('🐰 BunnyRecc: DEBUG - createPerChatConfigSection() returning content, length:', content.length);
        console.log('🐰 BunnyRecc: DEBUG - First 200 chars of content:', content.substring(0, 200));
        return content;
    }

    createConnectionProfileSection() {
        return `
            <div class="wide100p">
                <h4 style="margin-bottom: 10px;">🔗 Connection Profile</h4>
                <select id="bunnyRecc_connectionProfile" class="text_pole wide100p">
                    <option value="">Select a connection profile...</option>
                </select>
            </div>
        `;
    }

    createContextSelectionSection() {
        return `
            <div class="wide100p">
                <h4 style="margin-bottom: 10px;">📝 Context to Send</h4>
                <div class="checkbox_group" style="margin-bottom: 15px;">
                    <label class="checkbox_label">
                        <input type="checkbox" id="bunnyRecc_bunnyMoDescription" checked>
                        <span>BunnyMo Description</span>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" id="bunnyRecc_charCard" checked>
                        <span>Character Card</span>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" id="bunnyRecc_worldInfo" checked>
                        <span>World Info</span>
                    </label>
                </div>
                
                <h5 style="margin-bottom: 10px;">📚 Lorebooks to Include</h5>
                <div id="bunnyRecc_configStatus" class="bunnyRecc-config-status" style="margin-bottom: 10px;"></div>
                <div class="bmt-search-container" style="margin-bottom: 10px;">
                    <input type="text" id="bunnyRecc_searchLorebooks" class="bmt-search-input" placeholder="🔍 Search lorebooks...">
                </div>
                <div id="bunnyRecc_lorebooksSelector" class="wide100p" style="max-height: 400px; min-height: 250px; overflow-y: auto; padding: 12px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; margin-bottom: 15px; background: var(--SmartThemeBlurTintColor);">
                    <span style="opacity: 0.5;">Available lorebooks will appear here...</span>
                </div>
                
                <label for="bunnyRecc_messageType" style="margin-bottom: 5px; display: block;">Messages to Include:</label>
                <select id="bunnyRecc_messageType" class="text_pole wide100p" style="margin-bottom: 10px;">
                    <option value="none">None</option>
                    <option value="last" selected>Last 10 Messages</option>
                    <option value="all">All Messages</option>
                    <option value="first">First X Messages</option>
                </select>
                
                <div id="bunnyRecc_messageCountContainer" style="display: none;">
                    <label for="bunnyRecc_messageCount" style="margin-bottom: 5px; display: block;">Number of Messages:</label>
                    <input type="number" id="bunnyRecc_messageCount" class="text_pole wide100p" value="10" min="1" max="100">
                </div>
            </div>
        `;
    }

    createTraitSelectionSection() {
        return `
            <div class="wide100p">
                <h4 style="margin-bottom: 10px;">🎭 Trait Selection</h4>
                <small style="opacity: 0.7; margin-bottom: 15px; display: block;">Select traits from your active BunnyMo packs:</small>
                <div id="bunnyRecc_traitSelector" style="min-height: 100px; padding: 10px; border: 1px dashed var(--SmartThemeBorderColor); border-radius: 6px; margin-bottom: 10px;">
                    <span style="opacity: 0.5;">Traits will appear here when BunnyMo packs are active...</span>
                </div>
                <button id="bunnyRecc_clearTraits" class="menu_button">Clear All Traits</button>
            </div>
        `;
    }

    createPromptSection() {
        return `
            <div class="wide100p">
                <h4 style="margin-bottom: 10px;">✍️ Character Prompt</h4>
                <textarea id="bunnyRecc_prompt" class="text_pole textarea_compact wide100p" 
                          placeholder="Describe the character you want to create... (e.g., 'Create a shy librarian who secretly practices magic')"
                          rows="4" style="margin-bottom: 15px;"></textarea>
                
                <div style="margin-bottom: 15px;">
                    <label for="bunnyRecc_outputFormat" style="margin-bottom: 5px; display: block;">Output Format:</label>
                    <select id="bunnyRecc_outputFormat" class="text_pole wide100p" style="margin-bottom: 10px;">
                        <option value="fullsheet">Fullsheet (Detailed)</option>
                        <option value="quicksheet">Quicksheet (Streamlined)</option>
                    </select>
                    
                    <label class="checkbox_label">
                        <input type="checkbox" id="bunnyRecc_postToChat">
                        <span>Post result to chat</span>
                    </label>
                </div>
                
                <div class="alignitemscenter flex-container marginBot15 flexFlowColumn flexBasis48p flexGrow flexShrink gap0" style="margin-bottom: 15px;">
                    <small>Max Response Tokens</small>
                    <input class="neo-range-slider" type="range" id="bunnyRecc_maxTokens" min="100" max="65536" step="100" value="1500">
                    <div class="wide100p">
                        <input class="neo-range-input" type="number" min="100" max="65536" step="100" data-for="bunnyRecc_maxTokens" id="bunnyRecc_maxTokens_counter" value="1500">
                    </div>
                    <small style="opacity: 0.7; display: block; text-align: center; margin-top: 5px;">Higher values allow longer character sheets but consume more tokens</small>
                </div>
                
                <button id="bunnyRecc_generate" class="menu_button wide100p" style="background: var(--SmartThemeEmColor); color: white; font-weight: 600;">
                    🐰✨ Generate Character
                </button>
            </div>
        `;
    }

    createResultsSection() {
        return `
            <div class="wide100p" style="display: flex; flex-direction: column; height: 100%;">
                <h4 style="margin-bottom: 15px; flex-shrink: 0;">🌟 Generated Characters</h4>
                <div id="bunnyRecc_results" style="flex: 1; min-height: 400px; padding: 20px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; background: var(--SmartThemeBlurTintColor); overflow-y: auto;">
                    <div style="text-align: center; padding: 60px 20px; opacity: 0.6;">
                        <div style="font-size: 3em; margin-bottom: 15px;">🐰💭</div>
                        <p style="margin-bottom: 8px; font-weight: 500;">Your generated characters will appear here...</p>
                        <small style="opacity: 0.7;">Use the form on the left to create amazing characters!</small>
                    </div>
                </div>
            </div>
        `;
    }

    initializePopupHandlers() {
        // Make this instance available globally for onclick handlers
        window.bunnyReccInstance = this;
        
        // Initialize tab switching
        this.setupTabHandlers();
        
        // Initialize connection profile dropdown
        this.setupConnectionProfileDropdown();
        
        // Initialize lorebook selection
        this.setupLorebookSelection();
        
        // Initialize trait selection
        this.setupTraitSelection();
        
        // Initialize message type handler
        this.setupMessageTypeHandler();
        
        // Initialize max tokens input handler
        this.setupMaxTokensHandler();
        
        // Initialize per-chat config handlers
        this.setupPerChatConfigHandlers();
        
        // Initialize generate button with chat state validation
        const generateBtn = document.getElementById('bunnyRecc_generate');
        if (generateBtn) {
            console.log('🐰 BunnyRecc: Generate button found, attaching click handler');
            generateBtn.addEventListener('click', (e) => {
                console.log('🐰 BunnyRecc: Generate button clicked!', e);
                this.generateCharacter();
            });
            
            // Set up chat state monitoring with small delay to ensure popup is ready
            setTimeout(async () => {
                await this.updateGenerateButtonState();
            }, 100);
            
            // Listen for chat changes to update button state
            const context = getContext();
            if (context?.eventSource) {
                context.eventSource.on('chat_changed', async () => {
                    await this.updateGenerateButtonState();
                });
            }
        } else {
            console.error('🐰 BunnyRecc: Generate button not found in DOM!');
        }

        // Initialize clear traits button
        const clearTraitsBtn = document.getElementById('bunnyRecc_clearTraits');
        if (clearTraitsBtn) {
            clearTraitsBtn.addEventListener('click', () => this.clearSelectedTraits());
        }
        
        // Load per-chat configuration
        this.loadBunnyMoConfig();
        
        // Setup scope change handlers
        this.setupScopeHandlers();
    }

    setupConnectionProfileDropdown() {
        // Use SillyTavern's ConnectionManagerRequestService exactly like WREC does
        const context = getContext();
        if (context && context.ConnectionManagerRequestService) {
            context.ConnectionManagerRequestService.handleDropdown(
                '#bunnyReccPopup #bunnyRecc_connectionProfile',
                this.settings.profileId,
                (profile) => {
                    this.settings.profileId = profile?.id ?? '';
                    this.saveSettings();
                    console.log('🐰 BunnyRecc: Connection profile selected:', profile?.name || 'None');
                    
                    // Enhanced profile validation
                    if (profile) {
                        const selectedApi = profile.api ? context.CONNECT_API_MAP[profile.api]?.selected : undefined;
                        console.log('🐰 BunnyRecc: Profile validation - API:', profile.api, 'Selected API:', selectedApi?.name);
                        if (selectedApi?.name?.toLowerCase().includes('gemini') && !selectedApi?.name?.toLowerCase().includes('flash')) {
                            console.warn('🐰 BunnyRecc: WARNING - Profile uses Gemini Pro, not Flash!');
                        }
                    }
                }
            );
            
            // Add delayed validation check to verify current profile selection
            setTimeout(() => {
                const currentSelection = document.getElementById('bunnyRecc_connectionProfile')?.value;
                if (currentSelection) {
                    const currentProfile = context.extensionSettings.connectionManager?.profiles?.find(p => p.id === currentSelection);
                    if (currentProfile) {
                        console.log('🐰 BunnyRecc: Current profile loaded:', currentProfile.name, 'API:', currentProfile.api);
                        const currentApi = currentProfile.api ? context.CONNECT_API_MAP[currentProfile.api]?.selected : undefined;
                        console.log('🐰 BunnyRecc: Current profile API details:', {
                            profileApi: currentProfile.api,
                            resolvedApi: currentApi?.name,
                            apiType: currentApi?.type,
                            isFlash: currentApi?.name?.toLowerCase().includes('flash'),
                            isGeminiPro: currentApi?.name?.toLowerCase().includes('gemini') && !currentApi?.name?.toLowerCase().includes('flash')
                        });
                    }
                } else {
                    console.warn('🐰 BunnyRecc: No profile currently selected in dropdown');
                }
            }, 1000);
        } else {
            console.warn('🐰 BunnyRecc: ConnectionManagerRequestService not available');
        }
    }

    setupLorebookSelection() {
        // Create intelligent lorebook selection with BunnyMo-aware prioritization
        console.log('🐰 BunnyRecc: Setting up intelligent lorebook selection...');
        
        try {
            const lorebooksContainer = document.getElementById('bunnyRecc_lorebooksSelector');
            const searchInput = document.getElementById('bunnyRecc_searchLorebooks');
            if (!lorebooksContainer) return;
            
            // Get available worlds and BunnyMo configuration
            const availableWorlds = world_names || [];
            const bunnyMoConfig = this.getBunnyMoConfiguration();
            
            if (availableWorlds.length === 0) {
                lorebooksContainer.innerHTML = '<span style="opacity: 0.5;">No lorebooks currently active</span>';
                return;
            }
            
            // Intelligent categorization
            const { priorityRepos, tagLibraries, otherWorlds } = this.categorizeWorlds(availableWorlds, bunnyMoConfig);
            
            // Function to render intelligently organized lorebooks
            const renderLorebooks = (searchTerm = '') => {
                let html = '';
                
                // Priority Character Repositories Section
                if (priorityRepos.length > 0) {
                    const filteredPriority = this.filterWorlds(priorityRepos, searchTerm);
                    if (filteredPriority.length > 0) {
                        html += this.renderLorebookSection(
                            '👤 Your Character Repositories', 
                            'These contain your configured BunnyMo characters',
                            filteredPriority,
                            'priority'
                        );
                    }
                }
                
                // Tag Libraries Section  
                if (tagLibraries.length > 0) {
                    const filteredTags = this.filterWorlds(tagLibraries, searchTerm);
                    if (filteredTags.length > 0) {
                        html += this.renderLorebookSection(
                            '📚 Tag Libraries',
                            'Selected lorebooks with trait definitions', 
                            filteredTags,
                            'tags'
                        );
                    }
                }
                
                // Other Available Lorebooks Section
                if (otherWorlds.length > 0) {
                    const filteredOther = this.filterWorlds(otherWorlds, searchTerm);
                    if (filteredOther.length > 0) {
                        html += this.renderLorebookSection(
                            '📋 Other Available Lorebooks',
                            'Additional lorebooks for trait extraction',
                            filteredOther, 
                            'other'
                        );
                    }
                }
                
                if (!html) {
                    html = '<div style="text-align: center; padding: 20px; opacity: 0.6;"><p>No lorebooks match your search</p></div>';
                }
                
                lorebooksContainer.innerHTML = html;
                this.attachLorebookEventListeners();
            };
            
            // Setup intelligent search
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    renderLorebooks(e.target.value.toLowerCase().trim());
                });
            }
            
            // Show configuration status
            this.updateConfigurationStatus(bunnyMoConfig);
            
            // Initial render with full intelligence
            renderLorebooks();
            
        } catch (error) {
            console.warn('🐰 BunnyRecc: Failed to setup lorebook selection:', error);
        }
    }

    updateConfigurationStatus(bunnyMoConfig) {
        const statusContainer = document.getElementById('bunnyRecc_configStatus');
        if (!statusContainer) return;
        
        const { characterRepos, selectedLorebooks, isConfigured } = bunnyMoConfig;
        
        if (!isConfigured) {
            statusContainer.innerHTML = `
                <div class="bunnyRecc-status-card no-config">
                    <div class="bunnyRecc-status-icon">⚠️</div>
                    <div class="bunnyRecc-status-content">
                        <span class="bunnyRecc-status-text">No BunnyMo configuration detected</span>
                        <small class="bunnyRecc-status-hint">Configure BunnyMo in extension settings for intelligent prioritization</small>
                    </div>
                </div>
            `;
        } else {
            const repoCount = characterRepos.length;
            const libCount = selectedLorebooks.length;
            
            statusContainer.innerHTML = `
                <div class="bunnyRecc-status-card configured">
                    <div class="bunnyRecc-status-icon">✨</div>
                    <div class="bunnyRecc-status-content">
                        <span class="bunnyRecc-status-text">BunnyMo Intelligence Active</span>
                        <small class="bunnyRecc-status-hint">${repoCount} character repos, ${libCount} tag libraries configured</small>
                    </div>
                </div>
            `;
        }
    }

    getBunnyMoConfiguration() {
        // Access the main BunnyMo extension settings
        try {
            const context = getContext();
            const mainExtension = context?.extensionSettings?.BunnyMoTags;
            if (mainExtension) {
                console.log('🐰 BunnyRecc: Found main BunnyMo settings:', mainExtension);
                return {
                    characterRepos: mainExtension.characterRepoBooks || [],
                    selectedLorebooks: mainExtension.selectedLorebooks || [],
                    isConfigured: !!(mainExtension.characterRepoBooks?.length || mainExtension.selectedLorebooks?.length)
                };
            } else {
                console.log('🐰 BunnyRecc: Main BunnyMo settings not found, using empty config');
                return { characterRepos: [], selectedLorebooks: [], isConfigured: false };
            }
        } catch (error) {
            console.warn('🐰 BunnyRecc: Could not access main BunnyMo settings:', error);
            return { characterRepos: [], selectedLorebooks: [], isConfigured: false };
        }
    }

    categorizeWorlds(availableWorlds, bunnyMoConfig) {
        const priorityRepos = [];
        const tagLibraries = [];
        const otherWorlds = [];
        
        availableWorlds.forEach(worldName => {
            if (bunnyMoConfig.characterRepos.includes(worldName)) {
                priorityRepos.push(worldName);
            } else if (bunnyMoConfig.selectedLorebooks.includes(worldName)) {
                tagLibraries.push(worldName);
            } else {
                otherWorlds.push(worldName);
            }
        });
        
        return { priorityRepos, tagLibraries, otherWorlds };
    }

    filterWorlds(worlds, searchTerm) {
        if (!searchTerm) return worlds;
        return worlds.filter(worldName => 
            worldName.toLowerCase().includes(searchTerm)
        );
    }

    renderLorebookSection(title, description, worlds, sectionType) {
        const sectionClass = `bunnyRecc-section-${sectionType}`;
        
        let html = `
            <div class="bunnyRecc-lorebook-section ${sectionClass}">
                <div class="bunnyRecc-section-header">
                    <div class="bunnyRecc-section-info">
                        <h6 class="bunnyRecc-section-title">${title}</h6>
                        <small class="bunnyRecc-section-desc">${description}</small>
                    </div>
                    <span class="bunnyRecc-section-count">${worlds.length}</span>
                </div>
                <div class="bunnyRecc-section-content">
        `;
        
        worlds.forEach(worldName => {
            const isSelected = this.settings.selectedLorebooks.includes(worldName);
            const itemClass = sectionType === 'priority' ? 'priority-item' : 
                            sectionType === 'tags' ? 'tags-item' : 'other-item';
            
            html += `
                <div class="bunnyRecc_lorebookItem ${itemClass}" data-world="${worldName}">
                    <div class="bunnyRecc-item-indicator ${sectionType}"></div>
                    <input type="checkbox" class="bunnyRecc_lorebookCheckbox" 
                           value="${worldName}" ${isSelected ? 'checked' : ''}>
                    <div class="bunnyRecc-item-content">
                        <span class="bunnyRecc-item-name">${worldName}</span>
                        <small class="bunnyRecc-item-type">${this.getWorldTypeDescription(sectionType)}</small>
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
        
        return html;
    }

    getWorldTypeDescription(sectionType) {
        const descriptions = {
            'priority': 'Character repository',
            'tags': 'Tag library', 
            'other': 'Available lorebook'
        };
        return descriptions[sectionType] || 'Lorebook';
    }
    
    attachLorebookEventListeners() {
        // Helper method to attach event listeners to lorebook items
        const lorebooksContainer = document.getElementById('bunnyRecc_lorebooksSelector');
        if (!lorebooksContainer) return;
        
        lorebooksContainer.querySelectorAll('.bunnyRecc_lorebookItem').forEach(item => {
            const checkbox = item.querySelector('.bunnyRecc_lorebookCheckbox');
            if (!checkbox) return;
            
            // Click on item toggles checkbox
            item.addEventListener('click', (e) => {
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
            
            // Handle checkbox change
            checkbox.addEventListener('change', async (e) => {
                const worldName = e.target.value;
                const isChecked = e.target.checked;
                
                if (isChecked) {
                    if (!this.settings.selectedLorebooks.includes(worldName)) {
                        this.settings.selectedLorebooks.push(worldName);
                    }
                } else {
                    const index = this.settings.selectedLorebooks.indexOf(worldName);
                    if (index > -1) {
                        this.settings.selectedLorebooks.splice(index, 1);
                    }
                }
                
                this.saveSettings();
                console.log('🐰 BunnyRecc: Updated lorebook selection:', this.settings.selectedLorebooks);
                
                // Clear existing packs and rediscover when lorebooks change
                this.availablePacks = [];
                
                // Refresh trait selection when lorebooks change  
                await this.setupTraitSelection();
            });
        });
    }

    setupMessageTypeHandler() {
        // Handle message type selection and show/hide count input
        const messageTypeSelect = document.getElementById('bunnyRecc_messageType');
        const messageCountContainer = document.getElementById('bunnyRecc_messageCountContainer');
        
        if (messageTypeSelect && messageCountContainer) {
            messageTypeSelect.addEventListener('change', (e) => {
                const selectedType = e.target.value;
                
                // Show count input for 'first' and 'last' options
                if (selectedType === 'first' || selectedType === 'last') {
                    messageCountContainer.style.display = 'block';
                    
                    // Update label based on selection
                    const label = messageCountContainer.querySelector('label');
                    if (label) {
                        label.textContent = selectedType === 'first' ? 'Number of First Messages:' : 'Number of Last Messages:';
                    }
                } else {
                    messageCountContainer.style.display = 'none';
                }
                
                // Save setting
                this.settings.contextToSend.messages.type = selectedType;
                this.saveSettings();
            });
        }
    }

    setupMaxTokensHandler() {
        const maxTokensSlider = document.getElementById('bunnyRecc_maxTokens');
        const maxTokensCounter = document.getElementById('bunnyRecc_maxTokens_counter');
        
        if (maxTokensSlider && maxTokensCounter) {
            // Set initial values from settings
            const initialValue = this.settings.maxResponseToken.toString();
            maxTokensSlider.value = initialValue;
            maxTokensCounter.value = initialValue;
            
            // Sync slider -> counter
            maxTokensSlider.addEventListener('input', (e) => {
                const newValue = parseInt(e.target.value) || 1500;
                maxTokensCounter.value = newValue.toString();
                this.settings.maxResponseToken = newValue;
                this.saveSettings();
            });
            
            // Sync counter -> slider
            maxTokensCounter.addEventListener('input', (e) => {
                const newValue = parseInt(e.target.value) || 1500;
                maxTokensSlider.value = newValue.toString();
                this.settings.maxResponseToken = newValue;
                this.saveSettings();
            });
            
            console.log('🐰 BunnyRecc: Max tokens slider initialized with value:', initialValue);
        }
    }

    setupPerChatConfigHandlers() {
        // Set up scan depth slider synchronization
        const scanDepthSlider = document.getElementById('bunnyRecc_scan_depth');
        const scanDepthCounter = document.getElementById('bunnyRecc_scan_depth_counter');
        
        if (scanDepthSlider && scanDepthCounter) {
            // Sync slider -> counter
            scanDepthSlider.addEventListener('input', (e) => {
                scanDepthCounter.value = e.target.value;
            });
            
            // Sync counter -> slider
            scanDepthCounter.addEventListener('input', (e) => {
                scanDepthSlider.value = e.target.value;
            });
        }
        
        // Set up save config button
        const saveConfigBtn = document.getElementById('bunnyRecc_save_config');
        if (saveConfigBtn) {
            saveConfigBtn.addEventListener('click', () => {
                this.saveBunnyMoConfiguration();
            });
        }
        
        // Set up reset config button
        const resetConfigBtn = document.getElementById('bunnyRecc_reset_config');
        if (resetConfigBtn) {
            resetConfigBtn.addEventListener('click', () => {
                this.resetBunnyMoConfiguration();
            });
        }
        
        console.log('🐰 BunnyRecc: Per-chat config handlers initialized');
    }

    saveBunnyMoConfiguration() {
        console.log('🐰 BunnyRecc: Saving per-chat configuration...');
        // Implementation for saving config
        const statusElement = document.getElementById('bunnyRecc_config_status');
        if (statusElement) {
            statusElement.textContent = '💾 Configuration saved successfully';
            statusElement.className = 'text_muted';
        }
    }

    resetBunnyMoConfiguration() {
        console.log('🐰 BunnyRecc: Resetting to global configuration...');
        // Implementation for resetting config
        const statusElement = document.getElementById('bunnyRecc_config_status');
        if (statusElement) {
            statusElement.textContent = '🌐 Using global settings';
            statusElement.className = 'text_muted';
        }
    }

    async setupTraitSelection() {
        // Populate trait selection interface with available BunnyMo packs
        console.log('🐰 BunnyRecc: Setting up trait selection...');
        
        try {
            await this.discoverBunnyMoPacks();
            this.renderTraitSelection();
        } catch (error) {
            console.warn('🐰 BunnyRecc: Failed to setup trait selection:', error);
        }
    }

    async discoverBunnyMoPacks() {
        // Analyze selected lorebooks to find BunnyMo tag entries
        console.log('🐰 BunnyRecc: Discovering available BunnyMo packs...');
        
        this.availablePacks = [];
        
        // Get lorebooks from BunnyRecc selection OR main BunnyMo extension
        let selectedLorebooks = this.settings.selectedLorebooks;
        if (selectedLorebooks.length === 0) {
            // Fall back to main BunnyMo extension's selected lorebooks
            const bunnyMoConfig = this.getBunnyMoConfiguration();
            selectedLorebooks = [...bunnyMoConfig.characterRepos, ...bunnyMoConfig.selectedLorebooks];
            console.log('🐰 BunnyRecc: Using main BunnyMo lorebooks:', selectedLorebooks);
        }
        
        if (selectedLorebooks.length === 0) {
            console.log('🐰 BunnyRecc: No lorebooks available for trait discovery');
            return;
        }

        for (const worldName of selectedLorebooks) {
            try {
                // Load world info data similar to how main extension does it
                const worldInfo = await loadWorldInfo(worldName);
                if (!worldInfo || !worldInfo.entries) {
                    console.warn(`🐰 BunnyRecc: Failed to load world info for: ${worldName}`);
                    continue;
                }

                // Scan entries for BunnyMo tags
                const entries = Object.values(worldInfo.entries);
                const packTraits = this.extractBunnyMoTraits(entries, worldName);
                
                if (packTraits.length > 0) {
                    this.availablePacks.push({
                        worldName: worldName,
                        traits: packTraits,
                        totalTraits: packTraits.length
                    });
                    console.log(`🐰 BunnyRecc: Found ${packTraits.length} BunnyMo traits in ${worldName}`);
                }
            } catch (error) {
                console.warn(`🐰 BunnyRecc: Error processing ${worldName}:`, error);
            }
        }
        
        console.log(`🐰 BunnyRecc: Discovery complete - ${this.availablePacks.length} packs with traits found`);
    }

    extractBunnyMoTraits(entries, worldName) {
        // Extract individual lorebook entries as selectable traits
        const traits = [];
        
        entries.forEach(entry => {
            // Skip entries without proper content
            if (!entry.content || entry.content.trim().length === 0) return;
            
            // Skip system/meta entries (common patterns)
            if (entry.comment && (
                entry.comment.toLowerCase().includes('system') ||
                entry.comment.toLowerCase().includes('meta') ||
                entry.comment.toLowerCase().includes('config')
            )) return;
            
            // Simple display name - use comment, keys, or fallback
            const displayName = entry.comment || entry.keys?.join(', ') || `Entry ${entry.uid}`;
            const traitValue = displayName;
            
            // Create trait object - no categorization needed
            traits.push({
                value: traitValue,
                displayName: displayName,
                sourceEntry: entry.comment || entry.uid,
                worldName: worldName,
                selected: false,
                entryUid: entry.uid,
                entryKeys: entry.keys || [],
                entryContent: entry.content,
                // Include full entry data for prompt injection
                fullEntry: entry
            });
        });
        
        // Sort traits by display name only
        return traits.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    renderTraitSelection() {
        const traitContainer = document.getElementById('bunnyRecc_traitSelector');
        if (!traitContainer) return;
        
        if (this.availablePacks.length === 0) {
            traitContainer.innerHTML = `
                <div style="text-align: center; padding: 20px; opacity: 0.6;">
                    <div style="font-size: 1.5em; margin-bottom: 10px;">🐰💭</div>
                    <p>No traits found in selected lorebooks.</p>
                    <small>Select lorebooks to see available traits.</small>
                </div>
            `;
            return;
        }
        
        // Get all traits from all packs (no categorization)
        const allTraits = [];
        this.availablePacks.forEach(pack => {
            allTraits.push(...pack.traits);
        });
        
        let html = '<div class="bunnyRecc-trait-container">';
        
        // Add search box for traits
        html += `
            <div class="bmt-search-container" style="margin-bottom: 12px;">
                <input type="text" id="bunnyRecc_searchTraits" class="bmt-search-input" placeholder="🔍 Search traits...">
            </div>
        `;
        
        // Simple list of all traits
        html += '<div class="bunnyRecc-trait-list">';
        allTraits.forEach(trait => {
            html += this.renderTraitItem(trait);
        });
        
        // Add selection summary
        const selectedTraits = this.getSelectedTraits();
        html += `
            <div class="bunnyRecc-trait-summary">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                    <span style="opacity: 0.7; font-size: 13px;">${selectedTraits.length} traits selected</span>
                    <button id="bunnyRecc_selectAllTraits" class="menu_button" style="padding: 4px 8px; font-size: 12px;">Select Random</button>
                </div>
            </div>
        `;
        
        html += '</div>'; // Close bunnyRecc-trait-container
        
        traitContainer.innerHTML = html;
        
        // Setup event handlers
        this.setupTraitEventHandlers();
    }


    renderTraitItem(trait) {
        const isSelected = trait.selected;
        const checkId = `trait_${trait.entryUid}`;
        
        return `
            <div class="bunnyRecc-trait-item ${isSelected ? 'selected' : ''}" data-trait-id="${checkId}">
                <input type="checkbox" class="bunnyRecc-trait-checkbox" 
                       id="${checkId}" 
                       ${isSelected ? 'checked' : ''}
                       data-category="${trait.category}" 
                       data-value="${trait.value}">
                <label for="${checkId}" class="bunnyRecc-trait-label">
                    <span class="bunnyRecc-trait-value">${trait.value}</span>
                    <small class="bunnyRecc-trait-source">from ${trait.worldName}</small>
                </label>
            </div>
        `;
    }

    setupTraitEventHandlers() {
        // Setup search functionality
        const searchInput = document.getElementById('bunnyRecc_searchTraits');
        if (searchInput) {
            console.log('🐰 BunnyRecc: Setting up search functionality for traits');
            searchInput.addEventListener('input', (e) => {
                this.filterTraits(e.target.value);
            });
            searchInput.addEventListener('keyup', (e) => {
                this.filterTraits(e.target.value);
            });
        } else {
            console.warn('🐰 BunnyRecc: Search input not found!');
        }
        
        // Setup trait selection handlers
        const checkboxes = document.querySelectorAll('.bunnyRecc-trait-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                this.handleTraitSelection(e.target);
            });
        });
        
        // Setup select popular traits button
        const selectAllBtn = document.getElementById('bunnyRecc_selectAllTraits');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                this.selectPopularTraits();
            });
        }
    }

    filterTraits(searchTerm) {
        const normalizedTerm = searchTerm.toLowerCase().trim();
        const traitItems = document.querySelectorAll('.bunnyRecc-trait-item');
        const categories = document.querySelectorAll('.bunnyRecc-trait-category');
        
        
        let visibleCount = 0;
        traitItems.forEach(item => {
            const valueElement = item.querySelector('.bunnyRecc-trait-value');
            const sourceElement = item.querySelector('.bunnyRecc-trait-source');
            
            if (!valueElement) {
                console.warn('🐰 BunnyRecc: Missing .bunnyRecc-trait-value element in', item);
                return;
            }
            
            const traitValue = valueElement.textContent.toLowerCase();
            const traitSource = sourceElement ? sourceElement.textContent.toLowerCase() : '';
            const matches = !normalizedTerm || traitValue.includes(normalizedTerm) || traitSource.includes(normalizedTerm);
            
            item.style.display = matches ? 'flex' : 'none';
            if (matches) visibleCount++;
        });
        
        
        // Show/hide categories based on visible traits
        categories.forEach(category => {
            const visibleTraits = category.querySelectorAll('.bunnyRecc-trait-item[style*="flex"], .bunnyRecc-trait-item:not([style*="none"])');
            category.style.display = visibleTraits.length > 0 ? 'block' : 'none';
        });
    }

    handleTraitSelection(checkbox) {
        const category = checkbox.dataset.category;
        const value = checkbox.dataset.value;
        const isChecked = checkbox.checked;
        
        // Update trait selected state
        this.availablePacks.forEach(pack => {
            const trait = pack.traits.find(t => t.category === category && t.value === value);
            if (trait) {
                trait.selected = isChecked;
                console.log('🐰 BunnyRecc: DEBUG - Trait selection updated:', trait.displayName, 'selected:', isChecked);
            }
        });
        
        // Update visual state
        const traitItem = checkbox.closest('.bunnyRecc-trait-item');
        traitItem.classList.toggle('selected', isChecked);
        
        // Update summary
        this.updateTraitSummary();
        
        console.log(`🐰 BunnyRecc: Trait ${isChecked ? 'selected' : 'deselected'}: ${value}`);
    }


    updateTraitSummary() {
        const selectedTraits = this.getSelectedTraits();
        const summary = document.querySelector('.bunnyRecc-trait-summary span');
        if (summary) {
            summary.textContent = `${selectedTraits.length} traits selected`;
        }
    }

    clearSelectedTraits() {
        console.log('🐰 BunnyRecc: Clearing all selected traits...');
        
        // Clear all trait selections in memory
        this.availablePacks.forEach(pack => {
            pack.traits.forEach(trait => {
                trait.selected = false;
            });
        });
        
        // Update UI - uncheck all checkboxes
        const checkboxes = document.querySelectorAll('.bunnyRecc-trait-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
            const traitItem = checkbox.closest('.bunnyRecc-trait-item');
            if (traitItem) {
                traitItem.classList.remove('selected');
            }
        });
        
        // Update summary
        this.updateTraitSummary();
        
        console.log('🐰 BunnyRecc: All traits cleared successfully');
    }

    selectPopularTraits() {
        // Select random traits from all available traits
        const maxToSelect = 6;
        
        // Get all traits
        const allTraits = [];
        this.availablePacks.forEach(pack => {
            allTraits.push(...pack.traits.filter(t => !t.selected));
        });
        
        // Shuffle and select random traits
        const shuffled = allTraits.sort(() => Math.random() - 0.5);
        const toSelect = shuffled.slice(0, Math.min(maxToSelect, shuffled.length));
        
        toSelect.forEach(trait => {
            trait.selected = true;
            const checkbox = document.getElementById(`trait_${trait.entryUid}`);
            if (checkbox) {
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event('change'));
            }
        });
        
        console.log(`🐰 BunnyRecc: Selected ${toSelect.length} random traits for character generation`);
    }


    getSelectedTraits() {
        const selected = [];
        this.availablePacks.forEach(pack => {
            pack.traits.forEach(trait => {
                if (trait.selected) {
                    selected.push(trait);
                }
            });
        });
        console.log('🐰 BunnyRecc: DEBUG - getSelectedTraits() returning:', selected.length, 'traits:', selected.map(t => t.displayName));
        return selected;
    }

    async updateGenerateButtonState() {
        const generateBtn = document.getElementById('bunnyRecc_generate');
        if (!generateBtn) {
            console.warn('🐰 BunnyRecc: Generate button not found when updating state');
            return;
        }
        
        // Use clean context detection
        const contextInfo = await this.getBunnyReccContext();
        
        if (contextInfo.hasValidContext) {
            generateBtn.disabled = false;
            generateBtn.style.opacity = '1';
            generateBtn.title = '';
            console.log('🐰 BunnyRecc: Generate button enabled');
        } else {
            generateBtn.disabled = true;
            generateBtn.style.opacity = '0.5';
            generateBtn.title = 'Open a chat first to generate characters';
            console.log('🐰 BunnyRecc: Generate button disabled - no chat open');
        }
    }

    /**
     * Get comprehensive context information using STMemoryBooks pattern
     * @returns {Object} Context object with character/group/chat information
     */
    async getBunnyReccContext() {
        try {
            // Import necessary variables from SillyTavern - same pattern as STMemoryBooks
            const { chat_metadata, characters, name2, this_chid } = await import('../../../../script.js');
            const { selected_group, groups } = await import('../../../group-chats.js');
            const context = getContext();

            let characterName = null;
            let chatId = null;
            let chatName = null;

            // Check if we're in a group chat
            const isGroupChat = !!selected_group;
            const groupId = selected_group || null;
            let groupName = null;

            if (isGroupChat) {
                // Group chat context
                const group = groups?.find(x => x.id === groupId);
                if (group) {
                    groupName = group.name;
                    chatId = group.chat_id;
                    chatName = chatId;
                    characterName = groupName; // For compatibility
                    console.log('🐰 BunnyRecc: Group chat detected:', groupName);
                }
            } else {
                // Single character chat context
                
                // Method 1: Use name2 variable (primary character name)
                if (name2 && name2.trim()) {
                    characterName = String(name2).trim();
                }
                // Method 2: Try characters array and this_chid
                else if (this_chid !== undefined && characters && characters[this_chid]) {
                    characterName = characters[this_chid].name;
                }
                // Method 3: Try chat_metadata as fallback
                else if (chat_metadata?.character_name) {
                    characterName = String(chat_metadata.character_name).trim();
                }
                
                // Normalize unicode characters
                if (characterName && characterName.normalize) {
                    characterName = characterName.normalize('NFC');
                }

                // Get chat ID from context
                try {
                    if (context?.chatId) {
                        chatId = context.chatId;
                        chatName = chatId;
                    } else if (typeof window.getCurrentChatId === 'function') {
                        chatId = window.getCurrentChatId();
                        chatName = chatId;
                    }
                } catch (error) {
                    console.warn('🐰 BunnyRecc: Could not get chat ID:', error);
                }
            }

            const result = {
                characterName,
                chatId,
                chatName,
                groupId,
                isGroupChat,
                groupName,
                // Additional BunnyRecc-specific properties
                hasValidContext: !!(characterName || groupName) && !!chatId,
                contextType: isGroupChat ? 'group' : 'character'
            };

            console.log('🐰 BunnyRecc: Context resolved:', result);
            console.log('🐰 BunnyRecc: Context validation - characterName:', !!characterName, 'groupName:', !!groupName, 'chatId:', !!chatId, 'hasValidContext:', result.hasValidContext);
            return result;

        } catch (error) {
            console.error('🐰 BunnyRecc: Error getting context:', error);
            return {
                characterName: null,
                chatId: null,
                chatName: null,
                groupId: null,
                isGroupChat: false,
                groupName: null,
                hasValidContext: false,
                contextType: 'unknown'
            };
        }
    }

    async generateCharacter() {
        console.log('🐰 BunnyRecc: generateCharacter() called');
        
        // Check context using STMemoryBooks-style detection
        const contextInfo = await this.getBunnyReccContext();
        
        if (!contextInfo.hasValidContext) {
            console.log('🐰 BunnyRecc: No chat open, showing warning');
            toastr.warning('Please open a chat first before generating characters.', '🐰 BunnyRecc');
            return;
        }
        
        console.log('🐰 BunnyRecc: Chat is open, proceeding with generation...');
        
        // Collect form data
        const formData = this.collectFormData();
        
        // Validate inputs
        if (!this.validateInputs(formData)) {
            return;
        }
        
        // Show loading state
        this.showLoadingState();
        
        try {
            // Generate character using AI
            const result = await this.callAIForCharacterGeneration(formData);
            
            // Display results
            this.displayGenerationResults(result);
            
            // WorldInfo creation is available via the button in results
            
        } catch (error) {
            console.error('🐰 BunnyRecc: Generation failed:', error);
            this.showError('Failed to generate character: ' + error.message);
        }
    }

    collectFormData() {
        // Collect all form inputs
        const messageType = document.getElementById('bunnyRecc_messageType')?.value || 'none';
        const messageCount = parseInt(document.getElementById('bunnyRecc_messageCount')?.value) || 10;
        
        return {
            profileId: document.getElementById('bunnyRecc_connectionProfile')?.value || '',
            prompt: document.getElementById('bunnyRecc_prompt')?.value || '',
            outputFormat: document.getElementById('bunnyRecc_outputFormat')?.value || 'fullsheet',
            postToChat: document.getElementById('bunnyRecc_postToChat')?.checked || false,
            selectedTraits: this.getSelectedTraits(),
            selectedLorebooks: this.settings.selectedLorebooks || [],
            contextOptions: {
                bunnyMoDescription: document.getElementById('bunnyRecc_bunnyMoDescription')?.checked || false,
                charCard: document.getElementById('bunnyRecc_charCard')?.checked || false,
                worldInfo: document.getElementById('bunnyRecc_worldInfo')?.checked || false,
                messages: {
                    type: messageType,
                    count: messageCount
                }
            }
        };
    }

    validateInputs(formData) {
        if (!formData.profileId) {
            this.showError('Please select a connection profile');
            return false;
        }
        
        if (!formData.prompt.trim()) {
            this.showError('Please enter a character description');
            return false;
        }
        
        return true;
    }

    showLoadingState() {
        const resultsDiv = document.getElementById('bunnyRecc_results');
        if (resultsDiv) {
            resultsDiv.innerHTML = `
                <div class="bunny-loading">
                    <div class="bunny-loading-icon">🐰💫</div>
                    <p>Creating your character...</p>
                    <div class="bunny-loading-spinner"></div>
                </div>
            `;
        }
    }

    showError(message) {
        const resultsDiv = document.getElementById('bunnyRecc_results');
        if (resultsDiv) {
            resultsDiv.innerHTML = `
                <div class="bunny-error">
                    <div class="bunny-error-icon">🐰❌</div>
                    <p class="bunny-error-message">${message}</p>
                </div>
            `;
        }
    }

    async callAIForCharacterGeneration(formData) {
        console.log('🐰 BunnyRecc: Calling AI for character generation...', formData);
        
        try {
            // Prepare the context for the AI
            const generationContext = await this.buildGenerationContext(formData);
            
            // Build the prompt for character generation
            const prompt = await this.buildCharacterGenerationPrompt(generationContext, formData);
            
            // Calculate max tokens based on output format
            const maxTokens = document.getElementById('bunnyRecc_maxTokens')?.value || 
                             document.getElementById('bunnyRecc_maxTokens_counter')?.value || 
                             this.settings.maxResponseToken || 1500;
            
            // Call AI using SillyTavern's ConnectionManagerRequestService
            const context = getContext();
            
            console.log(`🐰 BunnyRecc: Sending request to profile ${formData.profileId} with ${maxTokens} max tokens`);
            
            // Ensure prompt is clean text (no malformed JSON or objects)
            const cleanPrompt = typeof prompt === 'string' ? prompt : String(prompt);
            
            // Convert prompt to proper message array format like WorldInfo-Recommender
            const messages = [{
                role: 'system',
                content: cleanPrompt
            }, {
                role: 'user', 
                content: `${formData.prompt}\n\nGenerate a character based on this request using the exact format specified in the system instructions.`
            }];
            
            // Validate connection profile before making request (like WorldInfo-Recommender)
            if (!formData.profileId) {
                throw new Error('No connection profile selected.');
            }
            
            const profile = context.extensionSettings.connectionManager?.profiles?.find((profile) => profile.id === formData.profileId);
            if (!profile) {
                throw new Error(`Connection profile with ID "${formData.profileId}" not found.`);
            }
            
            const selectedApi = profile.api ? context.CONNECT_API_MAP[profile.api].selected : undefined;
            if (!selectedApi) {
                throw new Error(`Could not determine API for profile "${profile.name}".`);
            }
            
            console.log('🐰 BunnyRecc: DEBUG - Profile Resolution Details:', {
                profileId: formData.profileId,
                profileName: profile.name,
                profileApi: profile.api,
                selectedApiName: selectedApi?.name || 'unknown',
                selectedApiType: selectedApi?.type || 'unknown',
                selectedApiUrl: selectedApi?.url || 'unknown',
                allAvailableProfiles: context.extensionSettings.connectionManager?.profiles?.map(p => ({
                    id: p.id.substring(0, 8) + '...', 
                    name: p.name, 
                    api: p.api
                })) || 'none',
                CONNECT_API_MAP_KEYS: Object.keys(context.CONNECT_API_MAP || {}),
                actualSelectedAPI: context.CONNECT_API_MAP[profile.api] ? {
                    name: context.CONNECT_API_MAP[profile.api].selected?.name,
                    type: context.CONNECT_API_MAP[profile.api].selected?.type,
                    url: context.CONNECT_API_MAP[profile.api].selected?.url
                } : 'not found',
                messageCount: messages.length,
                maxTokens: maxTokens
            });
            
            // Additional validation: Check if the API is actually what we expect
            if (selectedApi?.name?.toLowerCase().includes('gemini') && !selectedApi?.name?.toLowerCase().includes('flash')) {
                console.warn('🐰 BunnyRecc: WARNING - Selected API appears to be Gemini Pro instead of Flash!');
                console.warn('🐰 BunnyRecc: Expected Flash but got:', selectedApi.name);
                console.warn('🐰 BunnyRecc: Profile API field:', profile.api);
                console.warn('🐰 BunnyRecc: This may indicate a profile configuration issue');
            }
            
            const response = await context.ConnectionManagerRequestService.sendRequest(
                formData.profileId,
                messages,
                maxTokens,
                {
                    stream: false,
                    signal: null,
                    extractData: true,
                    includePreset: true,
                    includeInstruct: true
                }
            );
            
            // Process the AI response
            const result = this.processAIResponse(response, formData);
            
            console.log('🐰 BunnyRecc: Character generation completed successfully');
            return result;
            
        } catch (error) {
            console.error('🐰 BunnyRecc: AI generation failed:', error);
            throw new Error(`Character generation failed: ${error.message}`);
        }
    }

    async buildGenerationContext(formData) {
        console.log('🐰 BunnyRecc: Building generation context...');
        
        const context = getContext();
        let generationContext = {
            bunnyMoDescription: '',
            characterCard: '',
            worldInfo: '',
            messages: '',
            selectedTraits: [],
            lorebookContent: ''
        };
        
        // Include BunnyMo system description if requested
        if (formData.contextOptions.bunnyMoDescription) {
            generationContext.bunnyMoDescription = this.getBunnyMoSystemDescription();
        }
        
        // Include character card if requested  
        if (formData.contextOptions.charCard && context.characters?.[context.characterId]) {
            const character = context.characters[context.characterId];
            generationContext.characterCard = `Name: ${character.name}\nDescription: ${character.description}\nPersonality: ${character.personality}\nScenario: ${character.scenario}\nFirst Message: ${character.first_mes}`;
        }
        
        // Include World Info if requested
        if (formData.contextOptions.worldInfo) {
            generationContext.worldInfo = await this.buildWorldInfoContext();
        }
        
        // Include chat messages if requested
        if (formData.contextOptions.messages.type !== 'none' && context.chat) {
            generationContext.messages = await this.buildMessagesContext(formData.contextOptions.messages);
        }
        
        // Include selected traits from BunnyMo packs
        generationContext.selectedTraits = this.getSelectedTraits();
        
        // Include relevant lorebook content
        if (formData.selectedLorebooks.length > 0) {
            generationContext.lorebookContent = await this.buildLorebookContext(formData.selectedLorebooks);
        }
        
        return generationContext;
    }
    
    getBunnyMoSystemDescription() {
        return `BunnyMo is an advanced character analysis and psychological profiling system designed for AI roleplay. It provides comprehensive character analysis through structured tags and psychological frameworks:

CORE FEATURES:
- Structured tagging system using format <Category:Value> (e.g., <DERE:Tsundere>, <TRAIT:Intelligent>)
- Psychological profiling including attachment styles, trauma responses, dere types, MBTI types
- Character analysis through fullsheets (comprehensive 8-section analysis) and quicksheets (streamlined 6-section analysis)
- Integration with AI systems for enhanced character consistency and depth

KEY TAG CATEGORIES:
- CORE: <Name>, <SPECIES>, <GENDER>, <GENRE>
- PSYCHOLOGICAL: <DERE:Type>, <MBTI:Type>, <ATTACHMENT:Style>, <TRAUMA:Type>
- BEHAVIORAL: <FLIRTING:Style>, <AROUSAL:Type>, <JEALOUSY:Type>, <CONFLICT:Style>, <BOUNDARIES:Type>
- PHYSICAL: <BUILD:Type>, <SKIN:Type>, <DRESSSTYLE:Type>
- SOCIAL: <CHEMISTRY:Type>, <ORIENTATION:Type>, <POWER:Dynamic>, <KINK:Type>
- COMMUNICATION: <LINGUISTIC:Style>

The system emphasizes creating psychologically coherent characters where traits work together to form a believable personality ecosystem rather than random trait combinations.`;
    }
    
    async buildMessagesContext(messageConfig) {
        const context = getContext();
        if (!context.chat || context.chat.length === 0) {
            return '';
        }
        
        let messagesToInclude = [];
        const chatLength = context.chat.length;
        
        switch (messageConfig.type) {
            case 'last':
                const lastCount = Math.min(messageConfig.count || 10, chatLength);
                messagesToInclude = context.chat.slice(-lastCount);
                break;
            case 'first':
                const firstCount = Math.min(messageConfig.count || 10, chatLength);
                messagesToInclude = context.chat.slice(0, firstCount);
                break;
            case 'all':
                messagesToInclude = context.chat;
                break;
            default:
                return '';
        }
        
        return messagesToInclude.map(msg => `${msg.name}: ${msg.mes}`).join('\n');
    }
    
    async buildWorldInfoContext() {
        console.log('🐰 BunnyRecc: Building World Info context...');
        
        const context = getContext();
        let worldInfoContext = '';
        
        try {
            // Access SillyTavern's active WorldInfo entries
            // This gets the currently active WorldInfo that would normally be sent to AI
            if (context.worldInfoData && context.worldInfoData.length > 0) {
                worldInfoContext = context.worldInfoData.map(entry => {
                    return `${entry.comment ? `[${entry.comment}]` : ''}\n${entry.content}`;
                }).join('\n\n');
            } else {
                // Fallback: Try to get worldinfo from context if available
                const worldInfoString = context.worldInfoString || context.worldInfo || '';
                if (worldInfoString) {
                    worldInfoContext = worldInfoString;
                }
            }
            
        } catch (error) {
            console.warn('🐰 BunnyRecc: Failed to access World Info:', error);
        }
        
        return worldInfoContext.trim();
    }
    
    async buildLorebookContext(selectedLorebooks) {
        console.log('🐰 BunnyRecc: Building lorebook context from:', selectedLorebooks);
        
        let lorebookContext = '';
        
        for (const worldName of selectedLorebooks) {
            try {
                const worldInfo = await loadWorldInfo(worldName);
                if (worldInfo?.entries) {
                    const entries = Object.values(worldInfo.entries);
                    
                    // Focus on entries that contain BunnyMo style tags
                    const relevantEntries = entries.filter(entry => 
                        entry.content && entry.content.includes('<') && entry.content.includes('>')
                    );
                    
                    if (relevantEntries.length > 0) {
                        lorebookContext += `\n=== ${worldName} ===\n`;
                        relevantEntries.forEach(entry => {
                            if (entry.content) {
                                lorebookContext += `${entry.content}\n`;
                            }
                        });
                    }
                }
            } catch (error) {
                console.warn(`🐰 BunnyRecc: Failed to load lorebook ${worldName}:`, error);
            }
        }
        
        return lorebookContext.trim();
    }
    
    async buildAvailableTagsContext(formData) {
        console.log('🐰 BunnyRecc: Building available tags context...');
        
        if (!formData.selectedLorebooks || formData.selectedLorebooks.length === 0) {
            return null;
        }
        
        let allTags = new Set();
        
        for (const worldName of formData.selectedLorebooks) {
            try {
                const worldInfo = await loadWorldInfo(worldName);
                if (worldInfo?.entries) {
                    const entries = Object.values(worldInfo.entries);
                    
                    entries.forEach(entry => {
                        if (entry.content) {
                            // Extract BunnyMo tags from content
                            const tagMatches = [...entry.content.matchAll(/<([^:>]+):([^>]+)>/g)];
                            tagMatches.forEach(match => {
                                const category = match[1].trim();
                                const value = match[2].trim();
                                allTags.add(`<${category}:${value}>`);
                            });
                        }
                    });
                }
            } catch (error) {
                console.warn(`🐰 BunnyRecc: Failed to extract tags from ${worldName}:`, error);
            }
        }
        
        if (allTags.size === 0) {
            return null;
        }
        
        // Organize tags by category
        const categorizedTags = {};
        Array.from(allTags).forEach(tag => {
            const match = tag.match(/<([^:>]+):([^>]+)>/);
            if (match) {
                const category = match[1];
                const value = match[2];
                if (!categorizedTags[category]) {
                    categorizedTags[category] = [];
                }
                categorizedTags[category].push(value);
            }
        });
        
        // Format for prompt
        let tagsContext = 'Choose from these available tag options from your BunnyMo libraries:\n\n';
        Object.keys(categorizedTags).sort().forEach(category => {
            tagsContext += `${category}: ${categorizedTags[category].join(', ')}\n`;
        });
        
        return tagsContext;
    }
    
    async buildCharacterGenerationPrompt(context, formData) {
        console.log('🐰 BunnyRecc: Building character generation prompt...');
        
        const isFullsheet = formData.outputFormat === 'fullsheet';
        const selectedTraits = context.selectedTraits;
        
        // Use template system for main prompt - ensure templateManager is available
        if (!templateManager) {
            console.warn('🐰 BunnyRecc: Template manager not available, initializing...');
            try {
                const { initializeTemplateManager } = await import('./templateManager.js');
                const manager = initializeTemplateManager('BunnyMoTags');
                window.templateManager = manager; // Make it globally available
                console.log('🐰 BunnyRecc: Template manager initialized successfully');
            } catch (error) {
                console.error('🐰 BunnyRecc: Failed to initialize template manager, using fallback');
                return this.buildFallbackPrompt(context, formData);
            }
        }
        
        // Get templateManager reference (either imported or newly initialized)
        const manager = templateManager || window.templateManager;
        
        let prompt = '';
        
        // Build main system prompt with format specification
        const formatTemplate = isFullsheet ? 'fullsheetFormat' : 'quicksheetFormat';
        const formatContent = manager.getTemplate(formatTemplate)?.content || 'Generate a detailed character sheet with comprehensive BunnyMo tags.';
        
        // Build selected traits context with full entry content
        let selectedTraitsContext = '';
        console.log('🐰 BunnyRecc: DEBUG - Selected traits for generation:', selectedTraits);
        if (selectedTraits && selectedTraits.length > 0) {
            selectedTraitsContext = 'SELECTED TRAITS TO INCORPORATE:\n\n';
            selectedTraits.forEach(trait => {
                selectedTraitsContext += `**${trait.displayName}**\n`;
                selectedTraitsContext += `${trait.entryContent}\n\n`;
            });
            console.log('🐰 BunnyRecc: DEBUG - Selected traits context built:', selectedTraitsContext.length, 'characters');
        } else {
            console.log('🐰 BunnyRecc: DEBUG - No selected traits found!');
        }

        // Build available tags context if not present
        if (!context.availableTags) {
            context.availableTags = await this.buildAvailableTagsContext(formData);
        }

        const systemPromptVars = {
            SELECTED_TRAITS: selectedTraitsContext,
            BUNNYMO_DESCRIPTION: context.bunnyMoDescription || '',
            CHARACTER_CONTEXT: context.characterCard || '',
            WORLD_INFO: context.worldInfo || '',
            CHAT_CONTEXT: context.messages || '',
            LOREBOOK_CONTENT: context.lorebookContent || '',
            AVAILABLE_TAGS: context.availableTags || '',
            OUTPUT_FORMAT: formatContent,
            // SillyTavern template variables that will be processed by substituteParams
            user: '{{user}}',
            char: '{{char}}',
            persona: '{{persona}}'
        };
        
        // Use synchronous Handlebars compilation like WorldInfo-Recommender
        const systemPromptTemplate = manager.getTemplate('bunnyReccSystemPrompt');
        if (!systemPromptTemplate) {
            console.error('🐰 BunnyRecc: System prompt template not found');
            return this.buildFallbackPrompt(context, formData);
        }
        
        const compiledTemplate = Handlebars.compile(systemPromptTemplate.content, { noEscape: true });
        const systemPrompt = compiledTemplate(systemPromptVars);
        
        // Process SillyTavern variables like {{user}}, {{char}}, etc.
        const globalContext = getContext();
        const processedPrompt = globalContext.substituteParams(systemPrompt);
        
        console.log('🐰 BunnyRecc: DEBUG - Template variables:', systemPromptVars);
        console.log('🐰 BunnyRecc: DEBUG - SELECTED_TRAITS content preview:', systemPromptVars.SELECTED_TRAITS ? systemPromptVars.SELECTED_TRAITS.substring(0, 200) + '...' : 'EMPTY');
        console.log('🐰 BunnyRecc: DEBUG - Rendered system prompt type:', typeof processedPrompt);
        console.log('🐰 BunnyRecc: DEBUG - Rendered system prompt preview:', processedPrompt.substring(0, 500) + '...');
        
        prompt += processedPrompt;
        
        // Check if traits are in the final prompt (Handlebars should have already processed them)
        console.log('🐰 BunnyRecc: DEBUG - Checking if SELECTED_TRAITS made it into prompt:', prompt.includes('SELECTED TRAITS TO INCORPORATE'));
        if (selectedTraits && selectedTraits.length > 0) {
            selectedTraits.forEach(trait => {
                const traitInPrompt = prompt.toLowerCase().includes(trait.displayName.toLowerCase());
                console.log(`🐰 BunnyRecc: DEBUG - Trait "${trait.displayName}" found in prompt:`, traitInPrompt);
            });
        }
        
        // Add context sections using templates
        if (context.bunnyMoDescription) {
            const systemInfoVars = { SYSTEM_DESCRIPTION: context.bunnyMoDescription };
            const systemInfo = manager.renderTemplate('bunnyMoSystemInfo', systemInfoVars);
            prompt = prompt.replace('{{BUNNYMO_DESCRIPTION}}', systemInfo);
        } else {
            prompt = prompt.replace('{{BUNNYMO_DESCRIPTION}}', '');
        }
        
        if (context.characterCard) {
            const charContextVars = { CHARACTER_CARD: context.characterCard };
            const charContext = manager.renderTemplate('characterContextInfo', charContextVars);
            prompt = prompt.replace('{{CHARACTER_CONTEXT}}', charContext);
        } else {
            prompt = prompt.replace('{{CHARACTER_CONTEXT}}', '');
        }
        
        if (context.worldInfo) {
            const worldInfoVars = { WORLD_INFO: context.worldInfo };
            const worldInfoContext = manager.renderTemplate('worldInfoContext', worldInfoVars);
            prompt = prompt.replace('{{WORLD_INFO}}', worldInfoContext);
        } else {
            prompt = prompt.replace('{{WORLD_INFO}}', '');
        }
        
        if (context.messages) {
            const messagesVars = { MESSAGES: context.messages };
            const messagesContext = await manager.renderTemplate('chatMessagesContext', messagesVars);
            prompt = prompt.replace('{{CHAT_CONTEXT}}', messagesContext);
        } else {
            prompt = prompt.replace('{{CHAT_CONTEXT}}', '');
        }
        
        if (context.lorebookContent) {
            const lorebookVars = { LOREBOOK_CONTENT: context.lorebookContent };
            const lorebookContext = await manager.renderTemplate('lorebookContentContext', lorebookVars);
            prompt = prompt.replace('{{LOREBOOK_CONTENT}}', lorebookContext);
        } else {
            prompt = prompt.replace('{{LOREBOOK_CONTENT}}', '');
        }

        // Add available tag context
        const availableTagsContext = await this.buildAvailableTagsContext(formData);
        if (availableTagsContext) {
            const tagsVars = { AVAILABLE_TAGS: availableTagsContext };
            const tagsContext = await manager.renderTemplate('availableTagsContext', tagsVars);
            prompt = prompt.replace('{{AVAILABLE_TAGS}}', tagsContext);
        } else {
            prompt = prompt.replace('{{AVAILABLE_TAGS}}', '');
        }

        // Format is now included via {{OUTPUT_FORMAT}} in the main template
        console.log('🐰 BunnyRecc: Prompt build complete, using format:', formatTemplate);
        return prompt;
    }
    
    buildFallbackPrompt(context, formData) {
        console.log('🐰 BunnyRecc: Building fallback prompt (template manager not available)');
        
        const isFullsheet = formData.outputFormat === 'fullsheet';
        const selectedTraits = context.selectedTraits;
        
        let prompt = `You are BunnyRecc, a character generation assistant for SillyTavern. Create a detailed character based on the user's request.

`;

        // Add trait context if available - include full entry content
        if (selectedTraits && selectedTraits.length > 0) {
            prompt += `SELECTED TRAITS TO INCORPORATE:\n\n`;
            selectedTraits.forEach(trait => {
                prompt += `**${trait.displayName}**\n`;
                prompt += `${trait.entryContent}\n\n`;
            });
        }

        // Add context sections
        if (context.bunnyMoDescription) {
            prompt += `BunnyMo System Information:\n${context.bunnyMoDescription}\n\n`;
        }
        
        if (context.characterCard) {
            prompt += `Existing Character Context:\n${context.characterCard}\n\n`;
        }
        
        // Add format header (simplified)
        if (isFullsheet) {
            prompt += `Generate a character using the EXACT BunnyMo fullsheet format:\n\n`;
        } else {
            prompt += `Generate a character using the EXACT BunnyMo quicksheet format:\n\n`;
        }
        
        prompt += `IMPORTANT NOTES:
- Be creative and original while staying true to the user's request
- Include diverse and interesting traits
- BunnyTags should be comprehensive and follow the <Category:Value> format exactly
- Focus on psychological depth and realistic character development
- Ensure all sections are completed thoroughly
- Make the character feel authentic and three-dimensional`;

        return prompt;
    }
    
    processAIResponse(response, formData) {
        console.log('🐰 BunnyRecc: Processing AI response...', response);
        
        let characterSheet = '';
        
        // Extract the actual response text
        if (typeof response === 'string') {
            characterSheet = response;
        } else if (response?.choices?.[0]?.message?.content) {
            characterSheet = response.choices[0].message.content;
        } else if (response?.content) {
            characterSheet = response.content;
        } else {
            throw new Error('Invalid AI response format');
        }
        
        // Extract character name from the response (multiple patterns)
        let characterName = 'Generated Character';
        const namePatterns = [
            /\*\*Name:\*\*\s*([^\n]+)/i,
            /•\s*\*\*Name:\*\*\s*([^\n]+)/i,
            /Name:\s*([^\n]+)/i,
            /<Name:([^>]+)>/i,
            /CHARACTER.*SHEET.*\*\*([^\*\n]+)\*\*/i
        ];
        
        for (const pattern of namePatterns) {
            const match = characterSheet.match(pattern);
            if (match) {
                characterName = match[1].trim().replace(/[\[\]]/g, '');
                break;
            }
        }
        
        // Extract BunnyTags from the response - look for both individual tags and BunnymoTags blocks
        const extractedTags = [];
        
        // Extract from BunnymoTags block (primary method)
        const bunnyTagsBlockMatch = characterSheet.match(/<BunnymoTags>(.*?)<\/BunnymoTags>/s);
        if (bunnyTagsBlockMatch) {
            const tagsContent = bunnyTagsBlockMatch[1];
            const tagMatches = [...tagsContent.matchAll(/<([^:>]+):([^>]+)>/g)];
            extractedTags.push(...tagMatches.map(match => `<${match[1].trim()}:${match[2].trim()}>`));
        }
        
        // Fallback: extract individual tags from the entire response
        if (extractedTags.length === 0) {
            const individualTagMatches = [...characterSheet.matchAll(/<([^:>]+):([^>]+)>/g)];
            extractedTags.push(...individualTagMatches.map(match => `<${match[1].trim()}:${match[2].trim()}>`));
        }
        
        // Clean character sheet for display (remove any raw tag blocks)
        let cleanCharacterSheet = characterSheet
            .replace(/<BunnymoTags>.*?<\/BunnymoTags>/gs, '')
            .replace(/\*\*BUNNYTAGS\*\*[\s\S]*$/, '')
            .trim();
        
        return {
            characterSheet: cleanCharacterSheet,
            fullResponse: characterSheet,
            characterName: characterName,
            tags: extractedTags,
            outputFormat: formData.outputFormat,
            timestamp: Date.now()
        };
    }

    displayGenerationResults(result) {
        console.log('🐰 BunnyRecc: Displaying results...', result);
        
        const resultsDiv = document.getElementById('bunnyRecc_results');
        console.log('🐰 BunnyRecc: Results div found:', resultsDiv);
        
        if (!resultsDiv) {
            console.error('🐰 BunnyRecc: Results div not found! Looking for other containers...');
            console.log('Available divs:', document.querySelectorAll('[id*="bunny"], [id*="result"]'));
            return;
        }
        
        const { characterSheet, characterName, tags, outputFormat } = result;
        
        // Add timestamp to result and save to persistent results
        result.timestamp = Date.now();
        this.persistentResults.push(result);
        this.saveResultsSession();
        
        // Format the character sheet with proper styling
        const formattedSheet = this.formatCharacterSheetForDisplay(characterSheet);
        const timestamp = new Date(result.timestamp).toLocaleString();
        
        // Create new result element to append
        const newResultElement = document.createElement('div');
        newResultElement.className = 'bunny-result-entry latest';
        newResultElement.style.cssText = 'margin-bottom: 30px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; padding: 15px;';
        
        newResultElement.innerHTML = `
            <div class="bunny-result-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid var(--SmartThemeBorderColor);">
                <div class="bunny-result-info">
                    <h3 style="margin: 0;">✨ ${characterName}</h3>
                    <small style="opacity: 0.7;">${timestamp} (Latest)</small>
                </div>
                <div class="bunny-result-actions">
                    <button class="menu_button bunny-copy-btn" onclick="window.bunnyReccInstance.copyCharacterSheet('${encodeURIComponent(result.fullResponse)}')">
                        📋 Copy Full Sheet
                    </button>
                    <button class="menu_button bunny-create-wi-btn" onclick="window.bunnyReccInstance.createWorldInfoEntry('${encodeURIComponent(JSON.stringify(result))}')">
                        🌍 Create WorldInfo Entry
                    </button>
                </div>
            </div>
            <div class="bunny-result-content">
                <div class="bunny-character-sheet">
                    ${formattedSheet}
                </div>
                <div class="bunny-results-tags" style="margin-top: 15px;">
                    <h4>🏷️ BunnyTags (${tags.length}):</h4>
                    <div class="bunny-tags-list">
                        ${tags.map(tag => `<span class="bunny-tag">${tag}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
        
        // Mark any previous "latest" results as previous
        const previousLatest = resultsDiv.querySelectorAll('.latest');
        previousLatest.forEach(el => {
            el.classList.remove('latest');
            el.classList.add('previous');
            const latestLabel = el.querySelector('small');
            if (latestLabel) {
                latestLabel.textContent = latestLabel.textContent.replace(' (Latest)', '');
            }
        });
        
        // Append the new result
        resultsDiv.appendChild(newResultElement);
        
        // Scroll to the new result
        newResultElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Runtime style restoration to ensure tag visibility
        setTimeout(() => this.applyTagVisibilityFixes(resultsDiv), 100);
        
        // Initialize copy/create buttons
        this.setupResultsButtons(result);
    }
    
    formatCharacterSheetForDisplay(characterSheet) {
        // Add styling classes to make the character sheet more readable
        return characterSheet
            .replace(/^#\s+(.+)$/gm, '<h1 class="bunny-sheet-h1">$1</h1>')
            .replace(/^##\s+(.+)$/gm, '<h2 class="bunny-sheet-h2">$1</h2>')
            .replace(/^###\s+(.+)$/gm, '<h3 class="bunny-sheet-h3">$1</h3>')
            .replace(/^\*\*(.+)\*\*$/gm, '<strong class="bunny-sheet-strong">$1</strong>')
            .replace(/\n/g, '<br>')
            .replace(/<BunnymoTags>(.*?)<\/BunnymoTags>/gs, '<div class="bunny-tags-block">$1</div>');
    }

    setupResultsButtons(result) {
        // Placeholder for results button setup
        console.log('🐰 BunnyRecc: Results buttons initialized');
    }

    copyCharacterSheet(encodedSheet) {
        const sheet = decodeURIComponent(encodedSheet);
        navigator.clipboard.writeText(sheet).then(() => {
            this.showNotification('Character sheet copied to clipboard!');
        });
    }

    createWorldInfoEntry(encodedResult) {
        const result = JSON.parse(decodeURIComponent(encodedResult));
        // Implementation for WorldInfo entry creation
        console.log('🐰 BunnyRecc: Creating WorldInfo entry...', result);
        this.showNotification('WorldInfo entry creation not yet implemented');
    }

    showNotification(message) {
        // Simple notification system
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--SmartThemeBodyColor);
            color: var(--SmartThemeQuoteColor);
            padding: 12px 20px;
            border-radius: 6px;
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    initializePopupHandlers() {
        // Make this instance available globally for onclick handlers
        window.bunnyReccInstance = this;
        
        // Initialize tab switching - simple fix
        this.setupTabHandlers();
        
        // Initialize connection profile dropdown
        this.setupConnectionProfileDropdown();
        
        // Initialize lorebook selection
        this.setupLorebookSelection();
        
        // Initialize trait selection
        this.setupTraitSelection();
        
        // Initialize message type handler
        this.setupMessageTypeHandler();
        
        // Initialize max tokens input handler
        this.setupMaxTokensHandler();
        
        // Initialize per-chat config handlers
        this.setupPerChatConfigHandlers();
        
        // Initialize generate button with chat state validation
        const generateBtn = document.getElementById('bunnyRecc_generate');
        if (generateBtn) {
            console.log('🐰 BunnyRecc: Generate button found, attaching click handler');
            generateBtn.addEventListener('click', (e) => {
                console.log('🐰 BunnyRecc: Generate button clicked!', e);
                this.generateCharacter();
            });
            
            // Set up chat state monitoring with small delay to ensure popup is ready
            setTimeout(async () => {
                await this.updateGenerateButtonState();
            }, 100);
            
            // Listen for chat changes to update button state
            const context = getContext();
            if (context?.eventSource) {
                context.eventSource.on('chat_changed', async () => {
                    await this.updateGenerateButtonState();
                });
            }
        } else {
            console.error('🐰 BunnyRecc: Generate button not found in DOM!');
        }
    }

    setupTabHandlers() {
        const tabs = document.querySelectorAll('.bunnyrecc-tab');
        const tabContents = document.querySelectorAll('.bunnyrecc-tab-content');
        
        console.log('🐰 BunnyRecc: Setting up tab handlers, found', tabs.length, 'tabs and', tabContents.length, 'tab contents');
        
        tabs.forEach((tab, index) => {
            console.log(`🐰 BunnyRecc: Tab ${index}:`, tab.getAttribute('data-tab'), tab);
            tab.addEventListener('click', () => {
                console.log('🐰 BunnyRecc: Tab clicked:', tab.getAttribute('data-tab'));
                
                const tabName = tab.getAttribute('data-tab');
                console.log('🐰 BunnyRecc: Switching to tab:', tabName);
                
                // Hide ALL tab contents first
                tabContents.forEach(content => {
                    content.classList.remove('active');
                    content.style.display = 'none';
                    console.log('🐰 BunnyRecc: Hidden tab:', content.id);
                });
                
                // Remove active from all tab buttons
                tabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.opacity = '0.7';
                    t.style.borderBottom = '2px solid transparent';
                });
                
                // Activate clicked tab button
                tab.classList.add('active');
                tab.style.opacity = '1';
                tab.style.borderBottom = '2px solid #f0c674';
                
                // Show the target content
                const content = document.getElementById(`bunnyrecc-tab-${tabName}`);
                if (content) {
                    content.classList.add('active');
                    content.style.display = 'block';
                    content.style.position = 'relative';
                    content.style.width = '100%';
                    content.style.height = 'auto';
                    content.style.zIndex = '1';
                    
                    console.log('🐰 BunnyRecc: Activated tab content:', tabName);
                    console.log('🐰 BunnyRecc: Content innerHTML length:', content.innerHTML.length);
                } else {
                    console.error('🐰 BunnyRecc: Could not find content element for tab:', tabName);
                }
            });
        });
        
        tabContents.forEach((content, index) => {
            console.log(`🐰 BunnyRecc: Tab content ${index}:`, content.id, content);
        });
    }



    setupMessageTypeHandler() {
        // Handle message type selection changes
        const messageTypeSelect = document.getElementById('bunnyRecc_messageType');
        const messageCountInput = document.getElementById('bunnyRecc_messageCount');
        
        if (messageTypeSelect) {
            messageTypeSelect.addEventListener('change', (e) => {
                const isNone = e.target.value === 'none';
                if (messageCountInput) {
                    messageCountInput.disabled = isNone;
                    messageCountInput.style.opacity = isNone ? '0.5' : '1';
                }
            });
        }
    }

    loadBunnyMoConfig() {
        // Load BunnyMo configuration for the current chat/character
        console.log('🐰 BunnyRecc: Loading BunnyMo config...');
    }

    setupScopeHandlers() {
        // Handle scope selection changes
        console.log('🐰 BunnyRecc: Setting up scope handlers...');
    }

}

// Export the initialization function for the main BunnyMoTags extension
export async function initializeBunnyRecc() {
    console.log('🐰 BunnyRecc: Starting initialization...');
    
    const bunnyRecc = new BunnyRecc();
    await bunnyRecc.initialize();
    
    // Make it available globally for debugging
    window.bunnyRecc = bunnyRecc;
    window.bunnyReccInstance = bunnyRecc; // For onclick handlers
    
    return bunnyRecc;
}
