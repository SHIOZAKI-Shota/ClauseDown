export const proofread = {
	rules: {
		'no-doubled-joshi': { label: '同じ助詞の連続', description: '「甲は乙は」のように、同じ助詞が一文に重なっている' },
		'no-dropping-the-ra': { label: 'ら抜き言葉', description: '「来れる」「見れる」' },
		'no-double-negative-ja': { label: '二重否定', description: '「しないことはない」' },
		'no-mixed-zenkaku-and-hankaku-alphabet': { label: '全角・半角の混在', description: '同じ文書で英字の全角と半角が混ざっている' },
		prh: { label: '用字', description: '公用文・法令の書き方に合わない字（「または」→「又は」など）' },
		'legal-terms': {
			label: '法令の用字',
			description: '内閣法制局「法令における漢字使用等について」の言い換え（「捺印」→「押印」、「虞」→「おそれ」、「斡旋」→「あっせん」など）',
		},
		'legal-okurigana': {
			label: '法令の送り仮名',
			description:
				'同じ決定の送り仮名（「取り消しの」→「取消しの」、「支払いを」→「支払を」、「手続き」→「手続」など）。名詞として使っているときだけ指摘します',
		},
		'ja-no-abusage': { label: 'よくある誤用', description: '「規定を適応する」（→適用）、「似て異なるもの」（→似て非なるもの）など' },
		'no-hankaku-kana': { label: '半角カナ', description: '「ｶﾀｶﾅ」のような半角のカタカナ' },
		'legal-en': {
			label: '英文契約の言い回し',
			description: '「and/or」「herein」のようなあいまいな書き方と、「prior to」→「before」のような短くできる決まり文句。和文には当たりません',
		},
		'max-ten': { label: '読点の多い文', description: '一文に読点（、）が多すぎる。条文向けに上限を多めにしています' },
		'ja-no-redundant-expression': {
			label: '冗長な表現',
			description: '「することができる」「であると考えられる」など。条文では普通の言い回しも指摘します',
		},
	},
}
