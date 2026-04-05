/**
 * TLSH (Trend Locality Sensitive Hash) 类型声明
 */
declare module 'tlsh' {
  /**
   * 计算 TLSH 哈希值
   * @param data 输入数据的十六进制字符串或文本内容
   * @returns TLSH 哈希字符串
   */
  function tlsh(data: string): string

  export = tlsh
}
