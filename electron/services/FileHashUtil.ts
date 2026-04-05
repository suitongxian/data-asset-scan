import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'

// 大文件阈值：5MB
const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024
// 采样大小：4096 字节
const SAMPLE_SIZE = 4096

export interface FileHashResult {
  hash: string
  size: number
  isPartialHash: boolean  // 是否为大文件部分哈希
}

/**
 * 计算文件的 MD5 哈希值
 * 对于大文件（>5MB），采用首尾各取 4096 字节的方式计算
 */
export async function calculateFileHash(filePath: string): Promise<FileHashResult> {
  const stat = await fsPromises.stat(filePath)
  const fileSize = stat.size

  if (fileSize <= LARGE_FILE_THRESHOLD) {
    // 小文件：计算完整 MD5
    return calculateFullHash(filePath, fileSize)
  } else {
    // 大文件：首尾采样计算 MD5
    return calculatePartialHash(filePath, fileSize)
  }
}

/**
 * 计算文件完整内容的 MD5
 */
async function calculateFullHash(filePath: string, fileSize: number): Promise<FileHashResult> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5')
    const stream = fs.createReadStream(filePath)

    stream.on('data', (data) => {
      hash.update(data)
    })

    stream.on('end', () => {
      resolve({
        hash: hash.digest('hex'),
        size: fileSize,
        isPartialHash: false
      })
    })

    stream.on('error', (err) => {
      reject(err)
    })
  })
}

/**
 * 计算大文件的部分 MD5（首尾各取 4096 字节）
 */
async function calculatePartialHash(filePath: string, fileSize: number): Promise<FileHashResult> {
  const fd = await fsPromises.open(filePath, 'r')

  try {
    const headBuffer = Buffer.alloc(SAMPLE_SIZE)
    const tailBuffer = Buffer.alloc(SAMPLE_SIZE)

    // 读取文件头部
    await fd.read(headBuffer, 0, SAMPLE_SIZE, 0)

    // 读取文件尾部
    const tailOffset = fileSize - SAMPLE_SIZE
    await fd.read(tailBuffer, 0, SAMPLE_SIZE, tailOffset)

    // 合并计算 MD5
    const hash = crypto.createHash('md5')
    hash.update(headBuffer)
    hash.update(tailBuffer)

    return {
      hash: hash.digest('hex'),
      size: fileSize,
      isPartialHash: true
    }
  } finally {
    await fd.close()
  }
}

/**
 * 同步版本：计算文件的 MD5 哈希值
 */
export function calculateFileHashSync(filePath: string): FileHashResult {
  const stat = fs.statSync(filePath)
  const fileSize = stat.size

  if (fileSize <= LARGE_FILE_THRESHOLD) {
    // 小文件：计算完整 MD5
    const content = fs.readFileSync(filePath)
    const hash = crypto.createHash('md5').update(content).digest('hex')
    return {
      hash,
      size: fileSize,
      isPartialHash: false
    }
  } else {
    // 大文件：首尾采样计算 MD5
    const fd = fs.openSync(filePath, 'r')
    try {
      const headBuffer = Buffer.alloc(SAMPLE_SIZE)
      const tailBuffer = Buffer.alloc(SAMPLE_SIZE)

      fs.readSync(fd, headBuffer, 0, SAMPLE_SIZE, 0)
      fs.readSync(fd, tailBuffer, 0, SAMPLE_SIZE, fileSize - SAMPLE_SIZE)

      const hash = crypto.createHash('md5')
      hash.update(headBuffer)
      hash.update(tailBuffer)

      return {
        hash: hash.digest('hex'),
        size: fileSize,
        isPartialHash: true
      }
    } finally {
      fs.closeSync(fd)
    }
  }
}
