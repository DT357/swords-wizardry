import { parseHitDice } from './hit-dice.mjs';

export class SwordsWizardryTokenDocument extends TokenDocument {
  async _preCreate(data, options, user) {
    const result = await super._preCreate(data, options, user);
    if (!isAuthorizedActiveGM(user)) return result;

    const linked = data?.actorLink ?? this.actorLink;
    const actor = this.baseActor;
    if (
      linked === true
      || actor?.type !== 'npc'
      || Number(actor.system?.hp?.max) !== 0
    ) return result;

    try {
      const parsed = parseHitDice(actor.system?.hd);
      if (!Roll.validate(parsed.formula)) throw new Error('INVALID_HIT_DICE');
      const roll = await new Roll(parsed.formula).evaluate();
      if (!Number.isSafeInteger(roll.total) || roll.total <= 0) {
        throw new Error('INVALID_HIT_POINT_TOTAL');
      }
      this.updateSource({
        delta: {
          system: {
            hp: { max: roll.total, value: roll.total }
          }
        }
      });
    } catch {
      ui.notifications?.warn?.(
        game.i18n.localize('SWORDS_WIZARDRY.Token.InvalidHitDice')
      );
    }
    return result;
  }
}

function isAuthorizedActiveGM(user) {
  const creatorId = typeof user === 'string' ? user : user?.id;
  return game.user?.isGM === true
    && game.user?.isActiveGM === true
    && creatorId === game.user.id;
}
