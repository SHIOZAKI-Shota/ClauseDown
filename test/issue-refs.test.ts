import { describe, expect, it } from 'vitest'
import { issueRefs, splitIssueRefs, withIssueLines } from '../src/shared/issue-refs'

describe('版のメッセージの課題番号', () => {
    it('#番号 を拾い、閉じる書式の直後の番号だけを閉じる', () => {
        expect(issueRefs('第3条を改正 #4\n\nCloses #12\nfixes: #7\nRefs #9')).toEqual({ refs: [4, 7, 9, 12], closes: [7, 12] })
        expect(issueRefs('closed #1、Resolved #2 and #3')).toEqual({ refs: [1, 2, 3], closes: [1, 2] })
    })

    it('見出しの ## や URL の #、単語の途中は番号として扱わない', () => {
        expect(issueRefs('## 第1章 と https://example.com/a#3 と abc#4 と &#5;')).toEqual({ refs: [], closes: [] })
        expect(issueRefs('日本語の文中の課題#8に対応')).toEqual({ refs: [8], closes: [] })
        expect(issueRefs('disclose #3 ／ prefix #4')).toEqual({ refs: [3, 4], closes: [] })
    })

    it('選んだ課題の行を足す。すでに書いてある番号は重ねない', () => {
        expect(withIssueLines('休日を変更', [12], [4])).toBe('休日を変更\n\nCloses #12\nRefs #4')
        expect(withIssueLines('休日を変更 Closes #12', [12], [])).toBe('休日を変更 Closes #12')
        expect(withIssueLines('休日を変更', [], [])).toBe('休日を変更')
    })

    it('表示用に文と番号に分ける', () => {
        expect(splitIssueRefs('対応 #3、Closes #12')).toEqual(['対応 ', 3, '、Closes ', 12])
    })
})
