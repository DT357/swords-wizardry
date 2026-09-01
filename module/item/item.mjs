import { notifyOperationFailure } from '../helpers/notifications.mjs';
import {
  applyFoundryChatVisibility,
  readFoundryRollMode
} from '../rolls/chat-visibility.mjs';

const SYSTEM_ID = 'swords-wizardry';
const ITEM_CARD_TEMPLATE = `systems/${SYSTEM_ID}/module/templates/items/item-card.hbs`;
const DESCRIPTION_CARD_ICONS = Object.freeze({
  armor: `systems/${SYSTEM_ID}/assets/game-icons-net/chest-armor.svg`,
  item: `systems/${SYSTEM_ID}/assets/game-icons-net/swap-bag.svg`
});

export class SwordsWizardryItem extends Item {

  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    if (!data.img || data.img == "") {
      switch(data.type) {
        case "spell":
          data.img = `systems/swords-wizardry/assets/game-icons-net/spell-book.svg`;
          break;
        case "feature":
          data.img = `systems/swords-wizardry/assets/game-icons-net/skills.svg`;
          break;
        case "armor":
          data.img = `systems/swords-wizardry/assets/game-icons-net/chest-armor.svg`;
          break;
        case "weapon":
          data.img = `systems/swords-wizardry/assets/game-icons-net/plain-dagger.svg`;
          break;
        case "item":
          data.img = `systems/swords-wizardry/assets/game-icons-net/swap-bag.svg`;
          break;
        case "container": // TODO future
          data.img = `systems/swords-wizardry/assets/game-icons-net/swap-bag.svg`;
          break;
        default:
          data.img = `systems/swords-wizardry/assets/game-icons-net/swap-bag.svg`;
      }
    }
    return this.updateSource(data)
  }

  getRollData() {
    const rollData = { ...super.getRollData() };
    rollData.name = this.name;
    rollData.item = this;
    return rollData;
  }

  async post(options = {}) {
    if (this.type !== 'spell') return this.roll(options);
    const result = await game.swordswizardry.spells.post(this, options);
    return notifyOperationFailure(result, ['SWORDS_WIZARDRY.Spell.Validation']);
  }

  async cast(options = {}) {
    if (this.type !== 'spell') return this.roll(options);
    const result = await game.swordswizardry.spells.cast(this, options);
    return notifyOperationFailure(result, ['SWORDS_WIZARDRY.Spell.Validation']);
  }

  async roll(options = {}) {
    const item = this;
    switch (this.type) {
      case 'weapon':
        return notifyOperationFailure(
          await game.swordswizardry.weapons.attack(this, options)
        );
      case 'feature':
        return notifyOperationFailure(
          await game.swordswizardry.rolls.feature(this, options),
          ['SWORDS_WIZARDRY.Roll.Error']
        );
      case 'spell':
        return this.post(options);
      case 'item':
      case 'armor': {
        const speaker = ChatMessage.getSpeaker({ actor: this.actor });
        const rollMode = readFoundryRollMode(game.settings);
        const TextEditor = foundry.applications.ux.TextEditor;
        const renderTemplate = foundry.applications.handlebars.renderTemplate;
        const description = await TextEditor.enrichHTML(item.system.description ?? '', {
          relativeTo: item,
          rollData: item.actor?.getRollData?.() ?? {}
        });
        const content = await renderTemplate(ITEM_CARD_TEMPLATE, {
          item: {
            name: item.name,
            img: item.img || DESCRIPTION_CARD_ICONS[item.type]
          },
          description
        });
        return ChatMessage.create(applyFoundryChatVisibility(ChatMessage, {
          speaker: speaker,
          rollMode: rollMode,
          content,
          rolls: []
        }));
      }
    }
  }
}
