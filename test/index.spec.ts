import { CardanoCli } from '../src';

describe('index', () => {
  describe('create instance', () => {
    it('should return the cardano-cli path', () => {
      const instance = new CardanoCli({});
      const cliPath = instance.cliPath;

      expect(cliPath).toMatch('cardano-cli');
    });
  });
});
