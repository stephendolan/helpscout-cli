import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './output.js';

describe('htmlToPlainText', () => {
  it('converts Help Scout HTML bodies without link URLs or images', () => {
    const html = [
      '<p>Hello <a href="https://example.com">there</a></p>',
      '<p><img src="avatar.png" alt="avatar">Second line</p>',
    ].join('');

    expect(htmlToPlainText(html)).toBe('Hello there\n\nSecond line');
  });
});
