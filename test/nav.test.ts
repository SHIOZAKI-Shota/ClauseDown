import { describe, expect, it } from 'vitest'
import { backTargetOf, pageBackOf } from '../src/renderer/stores/nav'

const withDoc = { hasRepo: true, hasDoc: true }
const noDoc = { hasRepo: true, hasDoc: false }
const noRepo = { hasRepo: false, hasDoc: false }

describe('戻り先', () => {
    it('設定などから戻ると、開いていた画面に戻る', () => {
        expect(backTargetOf('history', withDoc)).toBe('history')
        expect(backTargetOf('schedule', noDoc)).toBe('schedule')
    })

    it('文書の画面でも文書が閉じていればリポジトリホーム、リポジトリがなければトップ', () => {
        expect(backTargetOf('editor', noDoc)).toBe('docs')
        expect(backTargetOf('editor', noRepo)).toBe('home')
        expect(backTargetOf(null, withDoc)).toBe('home')
    })

    it('課題・期日の画面は、入ってきた画面に戻る', () => {
        expect(pageBackOf('issues', 'editor', withDoc)).toBe('editor')
        expect(pageBackOf('issues', 'editor', noDoc)).toBe('docs')
        expect(pageBackOf('issues', 'issues', withDoc)).toBe('docs')
        expect(pageBackOf('schedule', null, withDoc)).toBe('docs')
        expect(pageBackOf('schedule', 'releases', noRepo)).toBe('home')
    })
})
