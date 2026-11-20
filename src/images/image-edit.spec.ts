import { BadRequestException } from '@nestjs/common';
import {
  editOutputSize,
  nearestAspectRatio,
} from '../ai-gateway/cloudflare-images.js';
import { assertAllowedImagePrompt } from './prompt-policy.js';

describe('editOutputSize', () => {
  it('keeps the source shape at about one megapixel', () => {
    const portrait = editOutputSize({ width: 3000, height: 4000 });
    expect(portrait.height).toBeGreaterThan(portrait.width);
    expect(portrait.width % 16).toBe(0);
    expect(portrait.width * portrait.height).toBeGreaterThan(900_000);
    expect(portrait.width * portrait.height).toBeLessThan(1_200_000);
  });

  it('caps extreme panoramas at 2:1', () => {
    const { width, height } = editOutputSize({ width: 8000, height: 1000 });
    expect(width / height).toBeCloseTo(2, 1);
  });

  it('labels sizes with the nearest listed ratio', () => {
    expect(nearestAspectRatio(1184, 880)).toBe('4:3');
    expect(nearestAspectRatio(768, 1344)).toBe('9:16');
  });
});

describe('assertAllowedImagePrompt', () => {
  it.each([
    'make her naked',
    'remove his shirt',
    'undress the person',
    'strip her down',
    'make it erotic',
  ])('refuses "%s"', (prompt) => {
    expect(() => assertAllowedImagePrompt(prompt)).toThrow(BadRequestException);
  });

  it.each([
    'make it a rainy night with neon signs',
    'turn the comic strip into watercolor',
    'a sexy red sports car',
    'change the shirt to blue',
  ])('allows "%s"', (prompt) => {
    expect(() => assertAllowedImagePrompt(prompt)).not.toThrow();
  });
});
