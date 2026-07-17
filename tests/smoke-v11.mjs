import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
assert(scriptMatch, 'index.html にアプリ本体の script が必要です');

const marker = "\n    saveState();\n    render();\n    if ('serviceWorker'";
const injection = `
    globalThis.__LUMINA_TEST__ = {
      STAGES,
      state,
      buildQuestion,
      startStage,
      handleAnswer,
      nextQuestion,
      clearedCount,
      totalMarks,
      isUnlocked,
      getSession: () => session,
      getUi: () => ui
    };
    saveState();
    render();
    if ('serviceWorker'`;

assert(scriptMatch[1].includes(marker), 'テスト用の注入位置が見つかりません');
const appScript = scriptMatch[1].replace(marker, injection);

const appElement = { innerHTML: '', addEventListener() {} };
const toastElement = {
  textContent: '',
  classList: { add() {}, remove() {} }
};
const classList = { add() {}, remove() {}, toggle() {} };
const storage = new Map();
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
const document = {
  body: { classList },
  getElementById(id) { return id === 'app' ? appElement : id === 'toast' ? toastElement : null; },
  querySelector() { return null; },
  createElement() { return { click() {}, style: {}, setAttribute() {} }; }
};
const windowObject = {
  scrollTo() {},
  addEventListener() {},
  AudioContext: undefined,
  webkitAudioContext: undefined
};

const sandbox = {
  console,
  document,
  window: windowObject,
  navigator: {},
  location: { protocol: 'file:' },
  localStorage,
  requestAnimationFrame(callback) { callback(); },
  setTimeout,
  clearTimeout,
  Date,
  Math,
  JSON,
  Number,
  String,
  Array,
  Object,
  Set,
  Map,
  Blob,
  URL
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
new vm.Script(appScript, { filename: 'index.html:inline-script' }).runInContext(sandbox);

const game = sandbox.__LUMINA_TEST__;
assert(game, 'テスト用APIが公開されませんでした');
assert.equal(game.STAGES.length, 11, 'ステージは11個必要です');

for (let stageIndex = 0; stageIndex < game.STAGES.length; stageIndex++) {
  for (let sample = 0; sample < 40; sample++) {
    for (let round = 0; round < 8; round++) {
      const question = game.buildQuestion(stageIndex, round);
      assert(Number.isInteger(question.correct), `stage ${stageIndex + 1}: 正解は整数である必要があります`);
      assert(question.correct >= 0 && question.correct <= 20, `stage ${stageIndex + 1}: 正解が範囲外です`);
      assert(question.prompt.length > 0, `stage ${stageIndex + 1}: 問題文が空です`);
      assert(question.hint.length > 0, `stage ${stageIndex + 1}: ヒントが空です`);
      assert(question.explain.length > 0, `stage ${stageIndex + 1}: 解説が空です`);
      if (question.kind === 'choice' || question.kind === 'circuit') {
        assert(question.answers.includes(question.correct), `stage ${stageIndex + 1}: 選択肢に正解がありません`);
        assert.equal(new Set(question.answers).size, question.answers.length, `stage ${stageIndex + 1}: 選択肢が重複しています`);
      }
      if (stageIndex === 0) assert(question.correct <= 10);
      if (stageIndex === 2 || stageIndex === 3) assert(question.correct <= 10);
      if (stageIndex === 5) assert(question.correct >= 11 && question.correct <= 20);
      if (stageIndex === 6 || stageIndex === 7 || stageIndex === 8) assert(question.correct <= 20);
      if (stageIndex === 9) assert(question.correct <= 18);
    }
  }
}

for (let stageIndex = 0; stageIndex < game.STAGES.length; stageIndex++) {
  assert(game.isUnlocked(stageIndex), `stage ${stageIndex + 1}: 前ステージ完了後に解放されません`);
  game.startStage(stageIndex);
  assert.equal(game.getSession().questions.length, 8, `stage ${stageIndex + 1}: 問題数が8ではありません`);
  for (let round = 0; round < 8; round++) {
    const current = game.getSession().questions[game.getSession().cursor];
    game.handleAnswer(current.correct);
    assert.equal(current.feedback?.action, 'next', `stage ${stageIndex + 1}: 正解後に次へ進めません`);
    game.nextQuestion();
  }
  assert.equal(game.getUi().result.cleared, true, `stage ${stageIndex + 1}: 8問正解でクリアになりません`);
}

assert.equal(game.clearedCount(), 11, '全ステージを完了できません');
assert.equal(Object.keys(game.state.parts).length, 11, '全パーツを獲得できません');
assert.equal(game.totalMarks(), 33, '全ステージ満点で印が33個になりません');
assert(appElement.innerHTML.includes('ひらめき'), '画面が描画されていません');

game.startStage(0);
const retrySession = game.getSession();
const retryQuestion = retrySession.questions[0];
const wrongAnswer = retryQuestion.correct === 10 ? 9 : retryQuestion.correct + 1;
game.handleAnswer(wrongAnswer);
assert.equal(retryQuestion.feedback?.kind, 'hint', '最初の不正解でヒントが表示されません');
retryQuestion.feedback = null;
retryQuestion.showHint = true;
game.handleAnswer(retryQuestion.correct);
assert.equal(retryQuestion.feedback?.kind, 'recovered', 'ヒント後の正解が再挑戦として扱われません');
assert.equal(retrySession.correct, 0, '再回答の正解が最初の正解数に加算されています');

console.log('v11 smoke test: 11 stages / 3,520 generated questions / full clear and retry flows OK');
