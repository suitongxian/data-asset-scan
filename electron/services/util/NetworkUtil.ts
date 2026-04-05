/**
 * 网络工具类
 * 提供获取本机 IP 和 MAC 地址的功能
 */

import * as os from 'node:os'

/**
 * 获取本机 IP 地址
 * 返回第一个非回环、非内部的 IPv4 地址
 */
export function getLocalIP(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

/**
 * 获取本机 MAC 地址
 * 返回第一个非回环、非内部的 MAC 地址
 */
export function getLocalMAC(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
        return iface.mac.toUpperCase()
      }
    }
  }
  return '00:00:00:00:00:00'
}

/**
 * 获取本机所有 IPv4 地址
 */
export function getAllIPs(): string[] {
  const ips: string[] = []
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address)
      }
    }
  }
  return ips
}

/**
 * 获取本机 IPv6 地址
 */
export function getIPv6(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv6' && !iface.internal) {
        return iface.address
      }
    }
  }
  return ''
}
