import type { ja } from './ja'

// ja の形をそのまま英語の辞書の型にする。値は文字列か、同じ引数をとる関数
export type Shape<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R : T[K] extends string ? string : Shape<T[K]>
}

export type Messages = Shape<typeof ja>
