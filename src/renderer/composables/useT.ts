import { storeToRefs } from 'pinia'
import { useApp } from '~/stores/app'

// 画面の言語の辞書。言語を切り替えると追従する。テンプレートでは {{ t.common.save }} と書く
export function useT() {
    return storeToRefs(useApp()).t
}
