/**
 * 测试价值
 * - 生产入口与可观察结果：`needsTranslation` 决定助手回复的操作栏是否出现「翻译」按钮。
 * - Bug／规则依据：翻译入口只在回复不是界面语言时出现，避免中文回复上也挂一个无用按钮。
 * - 现有覆盖缺口：新增判据，无既有覆盖。
 * - 最小失败输入：夹带英文术语和代码块的中文回复（不应出现按钮）。
 * - tier：unit（纯函数）。
 */
import { expect, it } from 'vitest';
import { needsTranslation } from '../messageTranslation';

it.each([
  ['an English reply in a Chinese UI', 'The build failed because the lockfile is out of date.', 'zh-CN', true],
  ['Chinese prose with English terms and code', '这个 React 组件用 useState 保存状态：\n```ts\nconst [value, setValue] = useState("hello world example");\n```\n改完重新运行即可。', 'zh-CN', false],
  ['Traditional Chinese in a Simplified Chinese UI', '這個設定會在重新啟動後生效。', 'zh-CN', false],
  ['Japanese in a Chinese UI', 'この設定は再起動後に有効になります。', 'zh-CN', true],
  ['a reply too short to judge', 'OK', 'zh-CN', false],
  ['English in an English UI', 'The build failed because the lockfile is out of date.', 'en', false],
  ['Chinese in an English UI', '构建失败，因为锁文件已过期。', 'en', true],
  ['Korean in a Korean UI', '설정은 다시 시작한 후에 적용됩니다.', 'ko', false],
  // Same script, different language: the manual entry must stay.
  ['French in an English UI', 'Le fichier est introuvable.', 'en', true],
  ['Dutch in an English UI', 'Het bestand is niet gevonden op de server.', 'en', true],
  ['Chinese in a Japanese UI', '构建失败，因为锁文件已过期。', 'ja', true],
  ['Japanese in a Japanese UI', 'この設定は再起動後に有効になります。', 'ja', false],
  ['Chinese prose with an unclosed English code block', '运行下面的命令修复依赖问题：\n```bash\npnpm install --frozen-lockfile # reinstall all of the packages', 'zh-CN', false],
] as const)('translation offer for %s', (_name, text, locale, expected) => {
  expect(needsTranslation(text, locale)).toBe(expected);
});
