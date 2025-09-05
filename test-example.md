# BunnyMoTags System Message Test Example

The new BunnyMoTags system creates **standalone system messages** between chat messages instead of injecting into existing messages. This solves persistence issues and gives much better control.

To test the system, send a **user message** containing a bunnymo code block:

## Text Format (Original BunnyMoTags Format)
```bunnymo
ExampleCharacter:
  - species: human
  - gender: female
  - genre: fantasy
  - personality: kuudere, intelligent
  - traits: academic, scholar, researcher, mysterious
  - physical: dark hair, intense gaze

AnotherExample:
  - species: fox, kitsune
  - gender: female
  - personality: playful, mischievous, clever
  - physical: red hair, amber eyes, fluffy tail
  - traits: curious, protective
```

## JSON Format (Also Supported)
```bunnymo
{
  "characters": [
    {
      "name": "Marcus",
      "tags": {
        "species": ["human", "warrior"],
        "personality": ["stoic", "loyal", "protective"],
        "physical": ["tall", "muscular", "brown hair", "green eyes"],
        "trait": ["disciplined", "honorable"]
      },
      "source": "Fantasy Pack"
    },
    {
      "name": "Luna",
      "tags": {
        "species": ["elf", "mage"],
        "personality": ["wise", "mystical", "gentle"],
        "physical": ["silver hair", "blue eyes", "pointed ears"],
        "dere": ["dandere"],
        "trait": ["magical", "ancient knowledge"]
      },
      "source": "Elf Pack"
    }
  ]
}
```

## Expected Result
After sending a user message with a bunnymo block, you should see:

1. **A new system message appears** between your message and the AI response
2. **Professional character cards** with SimTracker-quality styling
3. **Individual cards** for each character (not one big container)
4. **Complete persistence** - editing messages won't make cards disappear
5. **Collapse/expand button** if multiple characters are present
6. **Beautiful gradient backgrounds** unique to each character
7. **Organized tag sections** with proper icons and colors

## How It Works
- **User sends message** with ```bunnymo block
- **BunnyMoTags detects** the block automatically
- **System message created** with character cards
- **Original block optionally cleaned** from user message
- **Cards persist permanently** as part of chat history

## Tag Categories Supported
- **Species** 🧬 (red) - race, creature type
- **Personality** 💭 (teal) - character traits, behavior
- **Physical** 👁️ (blue) - appearance, body features  
- **Dere** 💖 (orange) - dere types (tsundere, yandere, etc.)
- **Trait** ⭐ (purple) - special characteristics
- **Kink** 🔥 (red) - preferences, fetishes
- **Other** 🏷️ (gray) - miscellaneous tags

## Features Demonstrated
1. **Multiple Characters**: Both single and multi-character displays
2. **Tag Organization**: Tags grouped by meaningful categories
3. **Visual Hierarchy**: Clear character names, tag counts, categorized display
4. **Interactive Elements**: Collapse/expand cards, collapse all button
5. **Professional Styling**: Clean design with proper spacing and colors
6. **AI Integration**: Tags are available to AI context as structured data