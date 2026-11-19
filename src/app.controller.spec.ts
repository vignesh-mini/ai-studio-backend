import { AppController } from './app.controller.js';

describe('AppController', () => {
  it('reports health', () => {
    expect(new AppController().health()).toEqual({ status: 'ok' });
  });
});
