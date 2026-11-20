import { BadRequestException } from '@nestjs/common';

// A first line of defence until a moderation model is added (Phase 7). Image editing
// accepts photos of real people, so sexualising or undressing anyone is refused.
const BLOCKED = [
  /\b(nude|nudity|naked|nsfw|porn\w*|hentai|topless|bottomless)\b/i,
  /\bundress\w*|\bstrip(ped|ping)?\s+(her|him|them|naked|down|off)\b/i,
  /\b(remove|take off|without)\b[^.]{0,30}\b(clothes|clothing|shirt|top|dress|bra|underwear|pants)\b/i,
  /\b(see[- ]?through|transparent)\b[^.]{0,20}\b(clothes|clothing|shirt|dress|top)\b/i,
  /\b(lingerie|seductive|erotic|sexual(ly)?)\b/i,
  /\b(child|kid|minor|teen|underage|schoolgirl|loli)\w*\b[^.]{0,40}\b(nude|naked|sexy|bikini|lingerie)\b/i,
];

export function assertAllowedImagePrompt(prompt: string) {
  if (BLOCKED.some((pattern) => pattern.test(prompt))) {
    throw new BadRequestException(
      'This request is not allowed. Sexual or undressing edits are not supported.',
    );
  }
}
