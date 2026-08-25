/**
 * M7 i18n 框架测试（FR-12.3/NFR-9）：
 * 默认中文、en 骨架、缺失回退链（目标语言→zh→键名）、插值、Provider 行为。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import {
  I18nProvider,
  interpolate,
  translate,
  useT,
} from '../src/ui/i18n/i18n';
import { ZH } from '../src/ui/i18n/zh';

function Probe() {
  const { lang, setLang, t } = useT();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <button type="button" onClick={() => setLang('en')}>
        切换
      </button>
      <span data-testid="label">{t('app.openFile')}</span>
      <span data-testid="missing">{t('no.such.key')}</span>
    </div>
  );
}

describe('translate / interpolate（纯函数）', () => {
  it('默认语言中文：zh 词典命中', () => {
    expect(translate('zh', 'app.openFile')).toBe('打开文件');
  });

  it('en 骨架词典命中', () => {
    expect(translate('en', 'app.openFile')).toBe('Open Files');
  });

  it('缺失键回退：en 无该键 → zh 值；双词典皆无 → 键名', () => {
    // en 词典已与 zh 对齐，用临时 zh-only 键验证「en 缺失 → zh 回退」分支
    const zhOnlyKey = '__m7_test.zh_only__';
    (ZH as Record<string, string>)[zhOnlyKey] = '仅中文';
    try {
      expect(translate('en', zhOnlyKey)).toBe('仅中文'); // zh 回退
      expect(translate('en', 'no.such.key')).toBe('no.such.key'); // 键名兜底
      expect(translate('zh', 'no.such.key')).toBe('no.such.key');
    } finally {
      delete (ZH as Record<string, string>)[zhOnlyKey];
    }
  });

  it('插值：{var} 替换；缺失变量保留占位符', () => {
    expect(interpolate('{n} 层', { n: 42 })).toBe('42 层');
    expect(interpolate('{a}/{b}', { a: 1 })).toBe('1/{b}');
    expect(interpolate('无变量')).toBe('无变量');
  });

  it('translate 支持 vars 插值', () => {
    expect(translate('zh', 'help.keys', { x: 1 })).toBe('按键');
    expect(interpolate('共 {n} 条', { n: '3' })).toBe('共 3 条');
  });
});

describe('I18nProvider / useT（组件）', () => {
  afterEach(() => cleanup());

  it('Provider 默认中文；setLang 切换英文后文案变化', () => {
    const { getByTestId } = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(getByTestId('lang').textContent).toBe('zh');
    expect(getByTestId('label').textContent).toBe('打开文件');
    fireEvent.click(getByTestId('lang').parentElement!.querySelector('button')!);
    expect(getByTestId('lang').textContent).toBe('en');
    expect(getByTestId('label').textContent).toBe('Open Files');
  });

  it('未包裹 Provider 时回退 zh 默认实现（存量组件直接渲染不受影响）', () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('label').textContent).toBe('打开文件');
    expect(getByTestId('missing').textContent).toBe('no.such.key');
  });

  it('initialLang 生效', () => {
    const { getByTestId } = render(
      <I18nProvider initialLang="en">
        <Probe />
      </I18nProvider>,
    );
    expect(getByTestId('label').textContent).toBe('Open Files');
  });
});
