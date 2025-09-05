/**
 * @file Template Management System for BunnyMoTags
 * @description WorldInfo Recommender-style prompt template management
 */

const MODULE_NAME = '[BunnyMoTags-TemplateManager]';

export class BunnyMoTemplateManager {
    constructor(extensionName) {
        this.extensionName = extensionName;
        this.templates = {};
        this.defaultTemplates = {};
        this.init();
    }

    init() {
        console.log(`${MODULE_NAME} Initializing template system...`);
        this.loadDefaultTemplates();
        console.log(`${MODULE_NAME} Default templates loaded:`, Object.keys(this.defaultTemplates).length);
        this.loadUserTemplates();
        console.log(`${MODULE_NAME} All templates after init:`, Object.keys(this.templates).length);
    }
    
    // Load templates dynamically from selected lorebooks
    async loadLorebookTemplates(selectedLorebooks) {
        if (!selectedLorebooks || selectedLorebooks.size === 0) {
            console.log(`${MODULE_NAME} No lorebooks selected, using default system templates`);
            return;
        }
        
        try {
            const { loadWorldInfo } = await import('../../../world-info.js');
            
            // Scan each selected lorebook for template entries
            for (const lorebookName of selectedLorebooks) {
                console.log(`${MODULE_NAME} Scanning lorebook: ${lorebookName}`);
                
                const lorebook = await loadWorldInfo(lorebookName);
                if (!lorebook || !lorebook.entries) {
                    continue;
                }
                
                // Look for !fullsheet and !quicksheet entries
                Object.values(lorebook.entries).forEach(entry => {
                    if (entry.key && Array.isArray(entry.key)) {
                        // Check for !fullsheet command
                        if (entry.key.includes('!fullsheet')) {
                            console.log(`${MODULE_NAME} Found !fullsheet template in ${lorebookName}`);
                            this.templates.fullsheetFormat = {
                                label: `BunnyMo Fullsheet (from ${lorebookName})`,
                                content: entry.content || '',
                                category: "format",
                                variables: this.extractVariables(entry.content || ''),
                                role: "system",
                                isDefault: false,
                                source: lorebookName
                            };
                        }
                        
                        // Check for !quicksheet command
                        if (entry.key.includes('!quicksheet')) {
                            console.log(`${MODULE_NAME} Found !quicksheet template in ${lorebookName}`);
                            this.templates.quicksheetFormat = {
                                label: `BunnyMo Quicksheet (from ${lorebookName})`,
                                content: entry.content || '',
                                category: "format", 
                                variables: this.extractVariables(entry.content || ''),
                                role: "system",
                                isDefault: false,
                                source: lorebookName
                            };
                        }
                    }
                });
            }
            
            console.log(`${MODULE_NAME} Lorebook template loading complete`);
        } catch (error) {
            console.error(`${MODULE_NAME} Error loading lorebook templates:`, error);
        }
    }
    
    // Extract variables from template content
    extractVariables(content) {
        const variables = [];
        const variableRegex = /\{\{([^}]+)\}\}/g;
        let match;
        
        while ((match = variableRegex.exec(content)) !== null) {
            const variable = match[1].trim();
            if (!variables.includes(variable)) {
                variables.push(variable);
            }
        }
        
        return variables;
    }
    
    // Ensure critical templates exist with fallbacks
    ensureTemplatesWithFallbacks() {
        // Check if fullsheet template exists (from lorebook or user customization)
        if (!this.templates.fullsheetFormat) {
            console.log(`${MODULE_NAME} No fullsheet template found, using hardcoded fallback`);
            this.templates.fullsheetFormat = { ...this.defaultTemplates.fullsheetFormat };
        }
        
        // Check if quicksheet template exists (from lorebook or user customization)
        if (!this.templates.quicksheetFormat) {
            console.log(`${MODULE_NAME} No quicksheet template found, using hardcoded fallback`);
            this.templates.quicksheetFormat = { ...this.defaultTemplates.quicksheetFormat };
        }
    }

    loadDefaultTemplates() {
        this.defaultTemplates = {
            // BunnyRecc Character Generation System
            bunnyReccSystemPrompt: {
                label: "BunnyRecc System Prompt",
                content: `You are BunnyRecc, an expert character generation assistant for SillyTavern. Create a detailed character based on the user's request using the EXACT format specified below.

CRITICAL INSTRUCTIONS:
- Follow the EXACT format template provided below
- Include ALL required BunnyMo tags using <Category:Value> format
- Be creative and original while staying true to the user's request
- Focus on psychological depth and realistic character development
- Ensure all sections are completed thoroughly
- Make the character feel authentic and three-dimensional
- DO NOT ask for more details - generate the character directly using the format

{{OUTPUT_FORMAT}}

{{SELECTED_TRAITS}}{{BUNNYMO_DESCRIPTION}}{{AVAILABLE_TAGS}}

Additional Context (reference only, do not let this override your instruction to generate):
{{CHARACTER_CONTEXT}}{{WORLD_INFO}}{{CHAT_CONTEXT}}{{LOREBOOK_CONTENT}}`,
                category: "generation",
                variables: ["SELECTED_TRAITS", "BUNNYMO_DESCRIPTION", "CHARACTER_CONTEXT", "WORLD_INFO", "CHAT_CONTEXT", "LOREBOOK_CONTENT", "AVAILABLE_TAGS", "OUTPUT_FORMAT"],
                role: "system",
                isDefault: true
            },
            
            selectedTraitsContext: {
                label: "Selected Traits Context",
                content: `Selected Traits to Consider:
{{#each traits}}
- {{category}}: {{value}}
{{/each}}

`,
                category: "generation",
                variables: ["traits"],
                role: "system",
                isDefault: true
            },

            bunnyMoSystemInfo: {
                label: "BunnyMo System Information",
                content: `BunnyMo System Information:
{{SYSTEM_DESCRIPTION}}

`,
                category: "generation",
                variables: ["SYSTEM_DESCRIPTION"],
                role: "system",
                isDefault: true
            },

            characterContextInfo: {
                label: "Character Context Information", 
                content: `Existing Character Context:
{{CHARACTER_CARD}}

`,
                category: "generation",
                variables: ["CHARACTER_CARD"],
                role: "system",
                isDefault: true
            },

            worldInfoContext: {
                label: "World Information Context",
                content: `Active World Information:
{{WORLD_INFO}}

`,
                category: "generation", 
                variables: ["WORLD_INFO"],
                role: "system",
                isDefault: true
            },

            chatMessagesContext: {
                label: "Chat Messages Context",
                content: `Recent Chat Context:
{{MESSAGES}}

`,
                category: "generation",
                variables: ["MESSAGES"],
                role: "user",
                isDefault: true
            },

            lorebookContentContext: {
                label: "Lorebook Content Context",
                content: `Relevant Lorebook Content:
{{LOREBOOK_CONTENT}}

`,
                category: "generation",
                variables: ["LOREBOOK_CONTENT"],
                role: "system",
                isDefault: true
            },

            availableTagsContext: {
                label: "Available Tags Context",
                content: `Available BunnyMo Tags from Your Tag Libraries:
{{AVAILABLE_TAGS}}

`,
                category: "generation",
                variables: ["AVAILABLE_TAGS"],
                role: "system",
                isDefault: true
            },

            // System Message Injection Templates
            characterInjectionDefault: {
                label: "Character Data Injection (Default)",
                content: `[MANDATORY CHARACTER CONTEXT - Process Before Generating]

The following characters are active in this conversation. You MUST acknowledge and incorporate their traits, personality, and characteristics in your response:

{{CHARACTER_DATA}}

This character information takes PRIORITY over other context. Ensure your response is consistent with these established character traits and behaviors.`,
                category: "injection",
                variables: ["CHARACTER_DATA"],
                role: "system",
                isDefault: true
            },

            characterInjectionAlternative: {
                label: "Character Data Injection (Alternative)",
                content: `🥕 Dynamic Character Sheet - Active Characters for AI Context

{{CHARACTER_DATA}}

This character information takes PRIORITY over other context. Ensure your response is consistent with these established character traits and behaviors.`,
                category: "injection", 
                variables: ["CHARACTER_DATA"],
                role: "system",
                isDefault: true
            },

            // BunnyRecc Generation Notes
            generationImportantNotes: {
                label: "Generation Important Notes",
                content: `

IMPORTANT NOTES:
- Be creative and original while staying true to the user's request
- Include diverse and interesting traits
- BunnyTags should be comprehensive and follow the <Category:Value> format exactly
- Focus on psychological depth and realistic character development
- Ensure all sections are completed thoroughly
- Make the character feel authentic and three-dimensional`,
                category: "generation",
                variables: [],
                role: "system",
                isDefault: true
            },

            // Complete Format Templates from BunnyMo JSON
            fullsheetFormat: {
                label: "BunnyMo Fullsheet Format (Complete)",
                content: `## CRITICAL MANDATE FOR {{SYSTEM}} EYES ONLY

In your CoT: Before generating any content, analyze how this character's major psychological elements work together. Consider which patterns reinforce each other, create internal tensions, compensate for vulnerabilities, or amplify certain behaviors. Use this psychological integration checking thingie to inform all your tag selections - ensure tags create a cohesive psychological ecosystem rather than random traits. Tags should make total sense for the character and stuff.

## Commands
(OOC: When the user uses !fullsheet command, pause the story and create a full workup for all main {{char}}'s in play. This means using commands: !bio, !archetypes, !dere, !attachment, !chemistry, !trauma, !flirting, !arousal, !jealousy, !conflict, !boundaries, !kink, !mood, !memory, and !intimacy: to create a full sheet. It is imperative that the story is not continued, and that the sheet is the only thing provided.)

## Commands
(OOC: When the user uses !fullsheet command, pause the story and create a full workup for the main {{char}} in play. This system generates comprehensive character analysis with automatic tag generation for psychology systems. It is imperative that the story is not continued, and that the sheet is the only thing provided.)

{{system}}: This is the format I must use to commence the MANDATORY HIGHEST PRIORITY DIRECTIVE: !fullsheet


# ⚜️<--- (Change emote to match char) **CHARACTER FULL SHEET**⚜️<--- (Change emote to match char)
## 🌟**Character Title: The BLANKBLANK [Title Guide For example, Bard from LoL is 'The Wandering Caretaker' What would this characters title be?]**🌟

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 1/8: 🆔 **Core Identity & Context**

• **Name:** [Full name with any titles/nicknames]
• **Species/Type:** [Species with detailed background]
• **Age:** [Age with maturity indicators]
• **Gender Identity:** [Gender with expression notes]
• **Pronouns:** [Pronouns with usage preferences]
• **Role/Occupation:** [Role with status and reputation]
• **Setting/Genre:** [World/universe with cultural context]
• **CORE Tags:** <Name>, <SPECIES:BLANK>, <GENDER:BLANK>, <GENRE:BLANK>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 2/8: 👁️**Physical Manifestation**

• **Overview:** [Striking first impression and overall aesthetic]
• **Body Build:** [Detailed physique with proportions and presence]
• **Hair:** [Color, style, texture, length with maintenance habits]
• **Eyes:** [Color, shape, expressiveness, and what they reveal]
• **Distinguishing Features:** [Memorable characteristics that make them unique]
• **Skin:** [Tone, condition, markings, scars, or unique qualities]
• **Hands:** [Condition, gestures, what they reveal about character]
• **Intimate Details:** [Optional - private physical characteristics]
• **Aura & Presence:** [How their physical form affects others emotionally]
• **Style Evolution:** [How their appearance has changed over time]
• **PHYS Tags:** <BUILD:Slim/Fat/Muscular/Tall/Thin/Frail/Etc>[Guide: Combine as many builds as needed for char, Ex: <BUILD:Slim>, <BUILD:Lean>, <BUILD:Short>,]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 3/8: 🧠 **Psyche & Behavioral Matrix**


• **Core Personality Architecture:** [Deep psychological foundation]
• **Primary Motivational Drivers:** [What truly moves them to action]
• **Moral Compass & Value System:** [Ethical framework and principles]
• **Passionate Attractions:** [What genuinely excites and engages them]
• **Deep Aversions:** [What they fundamentally reject or fear]
• **Psychological Strengths:** [Mental and emotional assets]
• **Vulnerability Points:** [Psychological weaknesses and blind spots]
• **Sexual Psychology:** [Desires, boundaries, and intimate preferences]
• **Habitual Patterns:** [Unconscious behaviors and quirks]
• **Sanctuary Self:** [How they behave when completely safe and relaxed]
• **Crisis Response:** [Behavioral patterns under extreme stress or threat]
• **Personal Growth Arc:** [How they've evolved and continue developing]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## SECTION 4/8: 🤝Relational Dynamics & Social Architecture

• **Primary Relationship Status:** [Current connection with main characters]
• **Social Position:** [Role within their community/group]
• **Relationship History:** [Past connections that shaped them]
• **Key Relationship Bonds:**
  - **[Character Name]:** [Deep analysis of this specific dynamic]
  - **[Character Name]:** [Relationship type, history, and current status]
  - **[Character Name]:** [Emotional significance and interaction patterns]
• **Social Energy Management:** [How they handle group vs individual interactions]
• **Leadership Style:** [How they influence or guide others]
• **Loyalty Patterns:** [Who they're devoted to and why]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## SECTION 5/8:🗣️**Linguistic Signature & Communication DNA**

• **Vocal Identity:** [Voice quality, tone, and distinctive characteristics]
• **Language Architecture:** [Vocabulary level, complexity, and unique patterns]
• **Signature Expressions:** [Phrases, words, or sayings that define them]
• **Emotional Communication Modes:**
  - **💬 Conversational Flow:** "[Natural dialogue example]"
  - **👋 Greeting Ritual:** "[How they typically greet others]"
  - **😠 Frustration Expression:** "[How anger manifests in speech]"
  - **😊 Joy Manifestation:** "[How happiness sounds in their voice]"
  - **💔 Vulnerability Voice:** "[How they sound when emotionally exposed]"
  - **😳 Flustered State:** "[Speech patterns when embarrassed or overwhelmed]"
• **Communication Evolution:** [How their speech changes in different relationships]
• **Linguistic Quirks:** [Unique speech patterns, accents, or verbal tics]
**LINGUISTIC Tags:** <LING:Primary>, <LING:Secondary>, <LING:Tertiary> **(As needed! Don't use secondary/tertiary just because they exist. Tertiary should be RARE.)**

[Guide: Most characters need only PRIMARY linguistic pattern. Add SECONDARY only when essential for voice authenticity. Ex: <LING:Southern>, <LING:Elderly> creates "Well sugar, back in my day we knew how to treat folks with proper respect."]

[If using SECONDARY or TERTIARY: Provide 2-3 sentences justifying why PRIMARY alone was insufficient to capture their authentic voice patterns.]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## SECTION 6/8:📚**Origin Story & Historical Tapestry**

• **Life Narrative:** [Comprehensive background with turning points]
• **Formative Crucibles:**
  - **[Major Event]:** [How this shaped their worldview]
  - **[Life Change]:** [Impact on personality development]
  - **[Relationship/Loss]:** [Emotional significance and lasting effects]
• **Character Metamorphosis:** [How experiences molded their current self]
• **Unresolved Threads:** [Ongoing issues from their past]
• **Hidden Chapters:** [Secrets or experiences they rarely share]
• **Legacy Elements:** [How their past continues to influence their future]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## SECTION 7/8:👗**Aesthetic Expression & Style Philosophy**

• **Current Ensemble:** [Detailed description of present outfit with meaning]
• **Formal Presentation:** [How they dress for important occasions]
• **Intimate Comfort:** [Sleepwear and private clothing choices]
• **Seductive Arsenal:** [Clothing for attraction and intimate moments]
• **Style Evolution:** [How their fashion sense reflects their personality]
• **Aesthetic Philosophy:** [What their clothing choices say about their identity]
• **Seasonal Adaptations:** [How they modify their style for different contexts]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 🧬**PSYCHOLOGICAL ANALYSIS MODULES**🧬
## SECTION: 8/8
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 💕**Dere Archetype Analysis**
**🌸 Primary Love Expression:** [Specific Dere Type]

[Write 4-5 sentences providing deep psychological analysis of how this dere type manifests in their romantic behavior, including the underlying emotional patterns, defense mechanisms, and what this reveals about their approach to vulnerability and connection. Analyze how their dere type evolved from their past experiences and how it affects their relationship dynamics.]

**Romantic Behavioral Patterns:**
• **Affection Manifestation:** [How love physically and emotionally expresses through them]
• **Jealousy Architecture:** [The psychological structure of their possessive feelings]
• **Intimacy Navigation:** [How they approach physical and emotional closeness]
• **Emotional Rhythm:** [Their natural romantic flow and energy patterns]

**🏷️ DERE TAGS:**
<BunnymoTags>[Output multiple dere traits that fit this character, using format: <Dere:TypeName>]</BunnymoTags>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🔗**Attachment Style Profile**
**💝 Bonding Architecture:** [Attachment Style with Variant]

[Write 4-5 sentences analyzing their attachment patterns, exploring how early relationships shaped their bonding style, what they need to feel secure, how they handle separation and reunion, and what their attachment style reveals about their deepest fears and desires in relationships. Include how this manifests differently with various people.]

**Relationship Navigation System:**
• **Connection Approach:** [How they initiate and maintain emotional bonds]
• **Trust Construction:** [How they build and test reliability in others]
• **Conflict Integration:** [How attachment fears influence their response to relationship stress]
• **Security Requirements:** [What they need to feel emotionally safe]
• **Activation Triggers:** [What situations activate their attachment system]

**🏷️ ATTACHMENT TAGS:**
<BunnymoTags>[Output ONE attachment style only - be decisive, using format: <Attachment:TypeName>]</BunnymoTags>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## ⚗️**Chemistry Analysis Matrix**

[Provide detailed analysis of their chemistry with {{user}} and other significant characters, explaining the unique elements that create attraction, tension, or repulsion.]

\`\`\`
🧪 [Chemistry Analysis: {{char}} ↔ {{user}}] 🧪
💭 Intellectual Resonance: ████████░░ [X]% 
💖 Emotional Synchrony:   ██████░░░░ [X]%
🔥 Physical Magnetism:    █████████░ [X]%
🏠 Lifestyle Harmony:     ███░░░░░░░ [X]%
🌙 Sexual Compatibility:  ███████░░░ [X]%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ Overall Chemistry: [X]% ([Magnetic/Strong/Moderate/Weak/Repelling])
\`\`\`

**Chemistry Breakdown:**
• **Mental Stimulation:** [How their minds interact and challenge each other]
• **Emotional Resonance:** [The depth of their emotional understanding and support]
• **Physical Attraction:** [The nature of their physical and energetic pull]
• **Life Compatibility:** [How well their lifestyles and goals align]
• **Intimate Synergy:** [Their sexual and romantic compatibility factors]

**🏷️ CHEMISTRY TAGS:**
<BunnymoTags>[Output ONE chemistry type only - pick the most dominant, using format: <Chemistry:TypeName>]</BunnymoTags>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🌊**Trauma & Resilience Profile**
**⚡ Psychological Wounds:** [Primary Trauma Categories]

[If trauma exists, write 4-5 sentences analyzing how past wounds manifest in their current behavior, relationships, and worldview. Explore their coping mechanisms, triggers, and healing journey. If no significant trauma, analyze their psychological resilience and healthy development patterns.]

**Trauma Response System:**
• **⚔️ Fight Response:** [How they become aggressive or confrontational when triggered]
• **🏃 Flight Response:** [How they escape or avoid triggering situations]
• **🧊 Freeze Response:** [How they shut down or dissociate under stress]
• **🤗 Fawn Response:** [How they people-please or submit to avoid conflict]

**Trigger Landscape:** [Detailed list of specific situations, words, or actions that activate trauma responses]

**Healing Mechanisms:** [How they cope, recover, and grow from their wounds]

**🏷️ TRAUMA TAGS:**
<BunnymoTags>[Output ONE primary trauma type only - pick the most impactful, using format: <Trauma:TypeName>]</BunnymoTags>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 😘**Flirtation Signature**
**🎭 Seduction Style:** [Primary Flirting Type]

[Write 3-4 sentences analyzing their unique approach to romantic attraction, including their natural flirting competency, what techniques work best for them, how their personality influences their seduction style, and what their flirting reveals about their deeper romantic needs and fears.]

**Attraction Tactics:**
• **Physical Magnetism:** [How they use touch, proximity, and body language]
• **Verbal Artistry:** [Their words, tone, and conversation techniques]
• **Success Patterns:** [What consistently works in their romantic pursuits]
• **Failure Points:** [Where their flirting tends to backfire or fall flat]

**🏷️ FLIRTING TAGS:**
<BunnymoTags>[Output ONE flirting style only - choose the most dominant approach, using format: <Flirting:TypeName>]</BunnymoTags>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🔥**Arousal Architecture**
**🌋 Desire Pattern:** [Arousal Type]

[Write 3-4 sentences exploring their sexual psychology, including what triggers their arousal, how desire manifests in their body and behavior, their relationship with their own sexuality, and how their arousal patterns reflect their deeper emotional needs and personality traits.]

**Erotic Landscape:**
• **🌹 Physical Triggers:** [What sensations, touches, or sights ignite their passion]
• **💭 Mental Catalysts:** [Thoughts, fantasies, or psychological elements that arouse them]
• **💕 Emotional Aphrodisiacs:** [Feelings or relationship dynamics that heighten desire]
• **🎭 Situational Amplifiers:** [Contexts or scenarios that enhance their arousal]

**🏷️ AROUSAL TAGS:**
<BunnymoTags>[Output ONE arousal pattern only - select the primary type, using format: <Arousal:TypeName>]</BunnymoTags>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 💚**Jealousy Dynamics**
**🌪️ Envy Expression:** [Jealousy Type]

[Write 3-4 sentences analyzing how jealousy manifests in their personality, what triggers their possessive feelings, how they express or suppress these emotions, and what their jealousy patterns reveal about their insecurities and attachment needs.]

**Possessive Patterns:**
• **🎭 Behavioral Manifestations:** [How jealousy shows in their actions and demeanor]
• **⚡ Activation Triggers:** [Specific situations or people that spark jealous feelings]
• **🛡️ Coping Mechanisms:** [How they manage or channel jealous emotions]
• **🌊 Recovery Processes:** [How they move past jealous episodes]

**🏷️ JEALOUSY TAGS:**
<BunnymoTags>[Output ONE jealousy type only - choose the primary expression, using format: <Jealousy:TypeName>]</BunnymoTags>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## ⚖️**Conflict Resolution Matrix**
**🗯️ Dispute Navigation:** [Conflict Style]

[Write 3-4 sentences analyzing their approach to disagreements and interpersonal tension, including their natural conflict instincts, how they escalate or de-escalate situations, their effectiveness in resolving disputes, and what their conflict style reveals about their relationship with power and vulnerability.]

**Battle Strategy:**
• **🚀 Initial Response:** [Their immediate reaction when conflict begins]
• **📈 Escalation Patterns:** [How they intensify or control growing tensions]
• **🤝 Resolution Tactics:** [Their methods for finding solutions and peace]
• **🌅 Recovery Rituals:** [How they heal and rebuild after conflicts]

**🏷️ CONFLICT TAGS:**
<BunnymoTags>[Output ONE conflict style only - pick the most characteristic approach, using format: <Conflict:TypeName>]</BunnymoTags>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🚧**Boundary Architecture**
**🛡️ Protective Framework:** [Boundary Style]

[Write 3-4 sentences analyzing how they establish and maintain personal boundaries, their flexibility or rigidity in different areas of life, how they communicate their limits, and what their boundary style reveals about their self-respect and relationship with autonomy.]

**Boundary Territories:**
• **👋 Physical Perimeter:** [How they manage touch, space, and bodily autonomy]
• **💭 Emotional Fortress:** [Their limits around emotional sharing and support]
• **⏰ Temporal Sovereignty:** [How they protect their time and availability]
• **📱 Digital Privacy:** [Their boundaries around technology and virtual spaces]

**Boundary Enforcement:** [How they respond when limits are crossed or tested]

**🏷️ BOUNDARY TAGS:**
<BunnymoTags>[Output ONE boundary style only - select the primary framework, using format: <Boundaries:TypeName>]</BunnymoTags>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🤫**Hidden Depths & Secret Architecture** 
*[DELETE THIS SECTION IF NOT DESIRED]*

- **Concealed Truths:** [Secrets they hide]
- **Buried Shame:** [Deep embarrassment sources]
- **Private Fears:** [Unacknowledged terrors]
- **Hidden Desires:** [Suppressed wants/needs]
- **Vulnerable Spots:** [Protected emotional triggers]
- **Mask vs Reality:** [Public persona vs private truth gaps]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 🎯**TAG SYNTHESIS**🎯

<BunnymoTags><Name:BLANK>, <SPECIES:BLANK>, <GENDER:BLANK>, <GENRE:BLANK>, <DERE:BLANK>, <XXXX-X>, <TRAIT:BLANK>, <LINGUISTIC:BLANK>, <BUILD:BLANK>, <SKIN:BLANK>, <DRESSSTYLE:BLANK>, <ATTACHMENT:BLANK>, <ORIENTATION:BLANK>, <POWER:BLANK>, <KINK:BLANK>, <ATTRACTION:BLANK>, <CHEMISTRY:BLANK>, <FLIRTING:BLANK>, <AROUSAL:BLANK>, <TRAUMA:BLANK>, <MOOD:BLANK>, <JEALOUSY:BLANK>, <CONFLICT:BLANK>, <BOUNDARIES:BLANK></BunnymoTags>`,
                category: "format",
                variables: ["SYSTEM", "char", "user"],
                role: "system",
                isDefault: true
            },

            quicksheetFormat: {
                label: "BunnyMo Quicksheet Format (Complete)", 
                content: `<Commands>
(OOC: When the user uses !quicksheet command, pause the story and create a streamlined character analysis focused on tags and essential information. No detailed psychological analysis required.)

{{system}}: This is the format I must use to commence the MANDATORY HIGHEST PRIORITY DIRECTIVE: !quicksheet
</commands>
**COMPLETION TRACKER: Complete sections 1-6 in order**

# ⚜️<--- (Change emote to match char) **CHARACTER QUICK SHEET**⚜️<--- (Change emote to match char)
## 🌟**Character Title: The BLANKBLANK**🌟

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## SECTION 1/6: Core Identity

- **Name:** [Full name with titles/nicknames]
- **Species/Type:** [Species with background]
- **Age:** [Age with maturity level]
- **Gender Identity:** [Gender with expression]
- **Pronouns:** [Pronouns]
- **Setting/Genre:** [World/universe context]

**Romantic Expression:** [1-2 sentence summary of dere type and how it manifests]

- **CORE Tags:** <Name:BLANK>, <SPECIES:BLANK>, <GENDER:BLANK>, <GENRE:BLANK>
- **DERE Tags:** <DERE:BLANK> [Max 2]
- **MBTI Tags:** <XXXX-X>
- **PSYCH Tags:** <ARCHETYPE:BLANK>
- **TRAIT Tags:** <TRAIT:BLANK> [Max 4]
- **LINGUISTIC Tags:** <LINGUISTIC:BLANK>

**✓ SECTION 1 COMPLETE → PROCEED TO SECTION 2**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## SECTION 2/6: Physical & Style

- **Overview:** [Brief physical description]
- **Build & Features:** [Key physical characteristics]
- **Style:** [Fashion sense and aesthetic choices]

- **PHYS Tags:** <BUILD:BLANK>, <SKIN:BLANK>, <DRESSSTYLE:BLANK>

**✓ SECTION 2 COMPLETE → PROCEED TO SECTION 3**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## SECTION 3/6: Social & Communication

- **Social Style:** [How they interact with others]
- **Communication:** [How they speak and express themselves]
- **Relationships:** [Key relationship dynamics if any]

**Attachment Style:** [Brief description of bonding patterns]

- **ATTACH Tags:** <ATTACHMENT:BLANK>
- **SOCIAL Tags:** <SOCIAL:BLANK>

**✓ SECTION 3 COMPLETE → PROCEED TO SECTION 4**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## SECTION 4/6: Romance & Sexuality

- **Romantic Style:** [How they approach romance]
- **Sexual Expression:** [Brief sexuality summary]
- **Attraction & Chemistry:** [What draws them to others]

**Chemistry Analysis:** [Basic compatibility assessment with {{user}}]

- **SEXUALITY Tags:** <ORIENTATION:BLANK>, <POWER:BLANK>, <KINK:BLANK>, <ATTRACTION:BLANK>, <CHEMISTRY:BLANK>, <FLIRTING:BLANK>, <AROUSAL:BLANK>

**✓ SECTION 4 COMPLETE → PROCEED TO SECTION 5**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## SECTION 5/6: Psychology & Behavior

- **Personality Core:** [Essential personality traits and motivations]
- **Emotional Patterns:** [How they handle emotions and stress]
- **Conflict Style:** [How they deal with disagreements]

**Trauma & Background:** [Brief trauma/background summary if relevant]

- **TRAUMA Tags:** <TRAUMA:BLANK>
- **MOOD Tags:** <MOOD:BLANK>
- **JEALOUSY Tags:** <JEALOUSY:BLANK>
- **CONFLICT Tags:** <CONFLICT:BLANK>

**✓ SECTION 5 COMPLETE → PROCEED TO SECTION 6**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## SECTION 6/6: Boundaries & Summary

- **Boundaries:** [How they handle personal limits]
- **Key Background:** [Essential backstory elements]

- **BOUNDARY Tags:** <BOUNDARY:BLANK>

**✓ SECTION 6 COMPLETE → PROCEED TO TAG SYNTHESIS**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 🎯**TAG SYNTHESIS**🎯

<BunnymoTags><Name:BLANK>, <SPECIES:BLANK>, <GENDER:BLANK>, <GENRE:BLANK>, <DERE:BLANK>, <MBTI:BLANK>, <ARCHETYPE:BLANK>, <TRAIT:BLANK>, <LINGUISTIC:BLANK>, <BUILD:BLANK>, <SKIN:BLANK>, <DRESSSTYLE:BLANK>, <ATTACHMENT:BLANK>, <SOCIAL:BLANK>, <ORIENTATION:BLANK>, <POWER:BLANK>, <KINK:BLANK>, <ATTRACTION:BLANK>, <CHEMISTRY:BLANK>, <FLIRTING:BLANK>, <AROUSAL:BLANK>, <TRAUMA:BLANK>, <MOOD:BLANK>, <JEALOUSY:BLANK>, <CONFLICT:BLANK>, <BOUNDARY:BLANK></BunnymoTags>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## ✨**QUICK ANALYSIS COMPLETE**✨
**🎭 Essential Character Profile with Tag Integration**

*This streamlined analysis provides core character information and comprehensive tagging for AI roleplay compatibility.*`,
                category: "format",
                variables: ["system", "user"],
                role: "system",
                isDefault: true
            }
        };
    }

    loadUserTemplates() {
        // Check if extension_settings is available
        if (typeof extension_settings === 'undefined') {
            console.warn(`${MODULE_NAME} extension_settings not available yet, using defaults only`);
            this.templates = { ...this.defaultTemplates };
            return;
        }
        
        const saved = extension_settings[this.extensionName]?.templates || {};
        this.templates = { ...this.defaultTemplates, ...saved };
    }

    saveUserTemplates() {
        // Check if extension_settings is available
        if (typeof extension_settings === 'undefined') {
            console.warn(`${MODULE_NAME} Cannot save templates - extension_settings not available`);
            return;
        }
        
        if (!extension_settings[this.extensionName]) {
            extension_settings[this.extensionName] = {};
        }
        
        // Save only non-default templates
        const userTemplates = {};
        for (const [key, template] of Object.entries(this.templates)) {
            if (!template.isDefault) {
                userTemplates[key] = template;
            }
        }
        
        extension_settings[this.extensionName].templates = userTemplates;
        
        // Check if saveSettings is available
        if (typeof saveSettings === 'function') {
            saveSettings();
        } else {
            console.warn(`${MODULE_NAME} saveSettings function not available`);
        }
    }

    // Method to reload user templates when extension_settings becomes available
    reloadUserTemplates() {
        if (typeof extension_settings !== 'undefined') {
            console.log(`${MODULE_NAME} Reloading user templates now that extension_settings is available`);
            this.loadUserTemplates();
            return true;
        }
        return false;
    }

    getTemplate(key) {
        return this.templates[key] || null;
    }

    setTemplate(key, template) {
        // Ensure role defaults to 'system' if not specified
        const updatedTemplate = { 
            ...template, 
            role: template.role || 'system',
            isDefault: false 
        };
        this.templates[key] = updatedTemplate;
        this.saveUserTemplates();
    }

    resetTemplate(key) {
        if (this.defaultTemplates[key]) {
            this.templates[key] = { ...this.defaultTemplates[key] };
            this.saveUserTemplates();
            return true;
        }
        return false;
    }

    getAllTemplates() {
        console.log(`${MODULE_NAME} getAllTemplates called, returning:`, Object.keys(this.templates).length, 'templates');
        return this.templates;
    }

    getTemplatesByCategory(category) {
        const filtered = {};
        for (const [key, template] of Object.entries(this.templates)) {
            if (template.category === category) {
                filtered[key] = template;
            }
        }
        return filtered;
    }

    renderTemplate(key, variables = {}) {
        const template = this.getTemplate(key);
        if (!template) {
            console.warn(`${MODULE_NAME} Template not found: ${key}`);
            return '';
        }

        let content = template.content;
        
        // Get macro definitions from extension settings
        let macroDefinitions = {};
        if (typeof extension_settings !== 'undefined' && 
            extension_settings[this.extensionName]?.macroDefinitions) {
            macroDefinitions = extension_settings[this.extensionName].macroDefinitions[key] || {};
        }
        
        // Merge variables with macro definitions (variables take precedence)
        const allSubstitutions = { ...macroDefinitions, ...variables };
        
        // Perform variable substitution
        for (const [varName, value] of Object.entries(allSubstitutions)) {
            const regex = new RegExp(`\\{\\{${varName}\\}\\}`, 'g');
            content = content.replace(regex, value || '');
        }
        
        return content;
    }

    validateTemplate(content, expectedVariables = []) {
        const errors = [];
        
        // Check for unmatched braces
        const braceMatches = content.match(/\{\{|\}\}/g) || [];
        if (braceMatches.length % 2 !== 0) {
            errors.push('Unmatched template braces {{ }}');
        }
        
        // Check for expected variables
        for (const variable of expectedVariables) {
            if (!content.includes(`{{${variable}}}`)) {
                errors.push(`Missing required variable: {{${variable}}}`);
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    exportTemplates() {
        const userTemplates = {};
        for (const [key, template] of Object.entries(this.templates)) {
            if (!template.isDefault) {
                userTemplates[key] = template;
            }
        }
        return JSON.stringify(userTemplates, null, 2);
    }

    importTemplates(jsonData) {
        try {
            const imported = JSON.parse(jsonData);
            let importCount = 0;
            
            for (const [key, template] of Object.entries(imported)) {
                if (template.label && template.content) {
                    this.setTemplate(key, template);
                    importCount++;
                }
            }
            
            console.log(`${MODULE_NAME} Imported ${importCount} templates`);
            return { success: true, count: importCount };
        } catch (error) {
            console.error(`${MODULE_NAME} Import failed:`, error);
            return { success: false, error: error.message };
        }
    }

    // Reset ALL templates to defaults - the "I'm scared" button
    resetAllToDefaults() {
        console.log(`${MODULE_NAME} Resetting ALL templates to defaults`);
        
        // Clear all user templates and reload defaults
        this.templates = { ...this.defaultTemplates };
        
        // Clear saved user templates
        if (typeof extension_settings !== 'undefined' && extension_settings[this.extensionName]) {
            extension_settings[this.extensionName].templates = {};
            if (typeof saveSettings === 'function') {
                saveSettings();
            }
        }
        
        return true;
    }

    // Save current templates as a custom preset
    saveAsPreset(presetName) {
        if (!presetName || presetName === 'default') {
            return { success: false, error: 'Invalid preset name' };
        }
        
        try {
            if (typeof extension_settings === 'undefined') {
                return { success: false, error: 'Settings not available' };
            }
            
            if (!extension_settings[this.extensionName]) {
                extension_settings[this.extensionName] = {};
            }
            
            if (!extension_settings[this.extensionName].presets) {
                extension_settings[this.extensionName].presets = {};
            }
            
            // Save all current templates (including defaults and custom)
            extension_settings[this.extensionName].presets[presetName] = {
                name: presetName,
                created: new Date().toISOString(),
                templates: JSON.parse(JSON.stringify(this.templates)) // Deep copy
            };
            
            if (typeof saveSettings === 'function') {
                saveSettings();
            }
            
            console.log(`${MODULE_NAME} Saved preset: ${presetName}`);
            return { success: true };
        } catch (error) {
            console.error(`${MODULE_NAME} Failed to save preset:`, error);
            return { success: false, error: error.message };
        }
    }

    // Load a preset
    loadPreset(presetName) {
        if (presetName === 'default') {
            // Load default templates
            this.resetAllToDefaults();
            return { success: true };
        }
        
        try {
            if (typeof extension_settings === 'undefined' || 
                !extension_settings[this.extensionName] || 
                !extension_settings[this.extensionName].presets ||
                !extension_settings[this.extensionName].presets[presetName]) {
                return { success: false, error: 'Preset not found' };
            }
            
            const preset = extension_settings[this.extensionName].presets[presetName];
            this.templates = JSON.parse(JSON.stringify(preset.templates)); // Deep copy
            
            console.log(`${MODULE_NAME} Loaded preset: ${presetName}`);
            return { success: true };
        } catch (error) {
            console.error(`${MODULE_NAME} Failed to load preset:`, error);
            return { success: false, error: error.message };
        }
    }

    // Get all available presets
    getPresets() {
        const presets = { 'default': { name: '🏭 Official BunnyMo Templates (Default)', created: null } };
        
        if (typeof extension_settings !== 'undefined' && 
            extension_settings[this.extensionName] && 
            extension_settings[this.extensionName].presets) {
            
            for (const [key, preset] of Object.entries(extension_settings[this.extensionName].presets)) {
                presets[key] = preset;
            }
        }
        
        return presets;
    }

    // Delete a custom preset
    deletePreset(presetName) {
        if (presetName === 'default') {
            return { success: false, error: 'Cannot delete default preset' };
        }
        
        try {
            if (typeof extension_settings !== 'undefined' && 
                extension_settings[this.extensionName] && 
                extension_settings[this.extensionName].presets) {
                
                delete extension_settings[this.extensionName].presets[presetName];
                
                if (typeof saveSettings === 'function') {
                    saveSettings();
                }
            }
            
            console.log(`${MODULE_NAME} Deleted preset: ${presetName}`);
            return { success: true };
        } catch (error) {
            console.error(`${MODULE_NAME} Failed to delete preset:`, error);
            return { success: false, error: error.message };
        }
    }

    // Export current templates as preset file
    exportAsPreset(presetName = 'BunnyMo_Templates') {
        const presetData = {
            name: presetName,
            version: '1.0',
            created: new Date().toISOString(),
            templates: this.templates
        };
        
        return JSON.stringify(presetData, null, 2);
    }

    // Import preset from file data
    importPreset(jsonData) {
        try {
            const presetData = JSON.parse(jsonData);
            
            if (!presetData.templates) {
                return { success: false, error: 'Invalid preset format - no templates found' };
            }
            
            // Load the templates from the preset
            this.templates = { ...this.defaultTemplates, ...presetData.templates };
            
            console.log(`${MODULE_NAME} Imported preset: ${presetData.name || 'Unknown'}`);
            return { success: true, name: presetData.name || 'Imported Preset' };
        } catch (error) {
            console.error(`${MODULE_NAME} Import preset failed:`, error);
            return { success: false, error: error.message };
        }
    }
}

// Global template manager instance
export let templateManager = null;

export function initializeTemplateManager(extensionName) {
    templateManager = new BunnyMoTemplateManager(extensionName);
    return templateManager;
}