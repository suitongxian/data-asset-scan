import {Router, Request, Response} from 'express';
import http from 'node:http';
import https from 'node:https';
import {URL} from 'node:url';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {DataDistributingRepository, ArchiveQueryOptions, ArchiveFileResult} from "../DataDistributingRepository.ts";
import {SystemConfigRepository} from "../SystemConfigRepository.ts";
import {calculateFileHash} from "../FileHashUtil";
import {getLogger} from "../LoggerService";

const logger = getLogger();

export function Archive(
    dataRepo: DataDistributingRepository,
    configRepo: SystemConfigRepository
): Router {

    const router = Router();
    router.post('/', handleArchiveFile); // 归档上传
    router.get('/list', handleArchiveList);// 远程查询已归档文件
    router.post('/download', handleArchiveDownload);// 归档文件下载
    /**
     * 处理文件归档上传请求
     * POST /archive
     * Body: { filePath: string, archiveApplication: ArchiveApplication }
     */
    async function handleArchiveFile(req: Request, res: Response): Promise<void> {
        interface ArchiveApplication {
            applicant_unit: string
            applicant_department: string
            applicant_name: string
            applicant_contact: string
            archive_file_name: string
            archive_file_category: string
            archive_file_hash: string
            application_time: string
            content_title: string
            data_classification: string
            protection_method: number
        }

        const params = req.body as { filePath: string, archiveApplication: ArchiveApplication }

        // 验证必填字段
        if (!params.filePath) {
            res.status(400).json({success: false, error: 'Missing required parameter: filePath'});
            return;
        }

        if (!params.archiveApplication) {
            res.status(400).json({success: false, error: 'Missing required parameter: archiveApplication'});
            return;
        }

        // 获取上传服务器地址
        const uploadServerUrl = configRepo.getUploadServerUrl();
        if (!uploadServerUrl) {
            res.status(400).json({success: false, message: '请先在系统设置中配置文件上传服务器地址'});
            return;
        }

        logger.info('Archive', '开始文件归档', {
            filePath: params.filePath,
            applicantName: params.archiveApplication.applicant_name
        });

        try {
            // 读取本地文件
            const fileContent = await fs.readFile(params.filePath);
            const fileName = path.basename(params.filePath);

            // 计算文件 MD5
            const hashResult = await calculateFileHash(params.filePath);
            const fileMd5 = hashResult.hash;

            // 更新申请表中的 hash
            params.archiveApplication.archive_file_hash = fileMd5;

            // 构建 multipart/form-data
            const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);

            // 构建各部分
            const filePart = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
            const md5Part = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="fileMd5"\r\n\r\n${fileMd5}`;
            const applicationPart = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="archiveApplication"\r\n\r\n${JSON.stringify(params.archiveApplication)}`;
            const endPart = `\r\n--${boundary}--\r\n`;

            const bodyBuffer = Buffer.concat([
                Buffer.from(filePart, 'utf8'),
                fileContent,
                Buffer.from(md5Part, 'utf8'),
                Buffer.from(applicationPart, 'utf8'),
                Buffer.from(endPart, 'utf8')
            ]);

            // 解析目标 URL
            const targetUrl = new URL('/api/file/archive', uploadServerUrl);
            const isHttps = targetUrl.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            // 发送请求
            const archiveResult = await new Promise<{ success: boolean, message?: string, data?: any }>((resolve) => {
                const archiveReq = httpModule.request({
                    hostname: targetUrl.hostname,
                    port: targetUrl.port || (isHttps ? 443 : 80),
                    path: targetUrl.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'Content-Length': bodyBuffer.length
                    }
                }, (archiveRes) => {
                    let responseData = '';
                    archiveRes.on('data', chunk => {
                        responseData += chunk
                    });
                    archiveRes.on('end', () => {
                        try {
                            const jsonResponse = JSON.parse(responseData);
                            if (jsonResponse.code === 0) {
                                logger.info('Archive', '文件归档成功', {fileName});
                                resolve({
                                    success: true,
                                    message: jsonResponse.message || '归档成功',
                                    data: jsonResponse.data
                                });
                            } else {
                                logger.error('Archive', '文件归档失败', null, {
                                    fileName,
                                    responseCode: jsonResponse.code,
                                    responseMessage: jsonResponse.message
                                });
                                resolve({success: false, message: jsonResponse.message || '归档失败'});
                            }
                        } catch {
                            if (archiveRes.statusCode && archiveRes.statusCode >= 200 && archiveRes.statusCode < 300) {
                                logger.info('Archive', '文件归档成功', {fileName});
                                resolve({success: true, message: '归档成功'});
                            } else {
                                logger.error('Archive', '文件归档失败', null, {
                                    fileName,
                                    statusCode: archiveRes.statusCode,
                                    responseData
                                });
                                resolve({
                                    success: false,
                                    message: `归档失败: ${archiveRes.statusCode} ${responseData}`
                                });
                            }
                        }
                    });
                });

                archiveReq.on('error', (error) => {
                    logger.error('Archive', '文件归档错误', error, {fileName});
                    resolve({success: false, message: `归档错误: ${error.message}`});
                });

                archiveReq.write(bodyBuffer);
                archiveReq.end();
            });

            // 更新文件上传状态
            const fileRecord = dataRepo.getByPathWithUploadState(params.filePath);
            if (fileRecord && fileRecord.data_distribution_id) {
                if (archiveResult.success) {
                    // 上传成功：更新当前文件状态为1（已上传）
                    dataRepo.updateUploadState(fileRecord.data_distribution_id, 1);
                    // 更新相同content_sign的其他文件状态为2（副本上传）
                    dataRepo.updateCopiesUploadState(fileRecord.content_sign, fileRecord.data_distribution_id);
                } else {
                    // 上传失败：更新当前文件状态为3（上传失败）
                    dataRepo.updateUploadState(fileRecord.data_distribution_id, 3);
                }
            }

            res.json(archiveResult);
        } catch (error) {
            const message = error instanceof Error ? error.message : '归档失败';
            res.json({success: false, message});
        }
    }

    /**
     * 处理归档文件列表查询请求
     * GET /archive/list?page=1&pageSize=10&applicant_name=张三
     * 代理到远程服务器的 /api/file/archive
     */
    async function handleArchiveList(req: Request, res: Response): Promise<void> {
        const uploadServerUrl = configRepo.getUploadServerUrl();
        if (!uploadServerUrl) {
            res.json({code: -1, message: '请先在系统设置中配置文件上传服务器地址'});
            return;
        }

        try {
            // 构建查询参数
            const page = req.query.page as string || '1';
            const pageSize = req.query.pageSize as string || '50';
            const applicantName = req.query.applicant_name as string;

            // 构建目标URL
            const targetUrl = new URL('/api/file/archive', uploadServerUrl);
            if (page) targetUrl.searchParams.set('page', page);
            if (pageSize) targetUrl.searchParams.set('pageSize', pageSize);
            if (applicantName) targetUrl.searchParams.set('applicant_name', applicantName);

            const isHttps = targetUrl.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            // 代理请求到远程服务器
            const proxyResult = await new Promise<{ code: number, message?: string, data?: any }>((resolve) => {
                const proxyReq = httpModule.request({
                    hostname: targetUrl.hostname,
                    port: targetUrl.port || (isHttps ? 443 : 80),
                    path: targetUrl.pathname + targetUrl.search,
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    }
                }, (proxyRes) => {
                    let responseData = '';
                    proxyRes.on('data', chunk => {
                        responseData += chunk
                    });
                    proxyRes.on('end', () => {
                        try {
                            const jsonResponse = JSON.parse(responseData);
                            resolve(jsonResponse);
                        } catch {
                            resolve({code: -1, message: '解析响应失败'});
                        }
                    });
                });

                proxyReq.on('error', (error) => {
                    resolve({code: -1, message: `请求失败: ${error.message}`});
                });

                proxyReq.end();
            });

            res.json(proxyResult);
        } catch (error) {
            const message = error instanceof Error ? error.message : '查询失败';
            res.json({code: -1, message});
        }
    }

    /**
     * 处理归档文件下载请求
     * POST /archive/download
     * Body: { archive_id: number, borrower_name: string, borrower_department: string, borrow_reason?: string, borrow_method: 1|2 }
     * 代理到远程服务器的 /api/file/download
     */
    async function handleArchiveDownload(req: Request, res: Response): Promise<void> {
        const uploadServerUrl = configRepo.getUploadServerUrl();
        if (!uploadServerUrl) {
            res.json({code: -1, message: '请先在系统设置中配置文件上传服务器地址'});
            return;
        }

        interface BorrowDownloadParams {
            archive_id: number
            borrower_name: string
            borrower_department: string
            borrow_reason?: string
            borrow_method: 1 | 2
        }

        const params = req.body as BorrowDownloadParams;

        // 验证必填字段
        if (!params.archive_id || !params.borrower_name || !params.borrower_department || !params.borrow_method) {
            res.json({
                code: -1,
                message: 'Missing required fields: archive_id, borrower_name, borrower_department, borrow_method'
            });
            return;
        }

        // 验证borrow_method值
        if (params.borrow_method !== 1 && params.borrow_method !== 2) {
            res.json({code: -1, message: 'Invalid borrow_method value. Must be 1 (online view) or 2 (download)'});
            return;
        }

        try {
            // 构建目标URL
            const targetUrl = new URL('/api/file/download', uploadServerUrl);
            const isHttps = targetUrl.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            // 标记是否已发送响应
            let responseSent = false;

            // 代理请求到远程服务器
            const proxyResult = await new Promise<{ code: number, message?: string, data?: any }>((resolve) => {
                const proxyReq = httpModule.request({
                    hostname: targetUrl.hostname,
                    port: targetUrl.port || (isHttps ? 443 : 80),
                    path: targetUrl.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    }
                }, (proxyRes) => {
                    // 如果返回的是文件（二进制），则透传给客户端
                    const contentType = proxyRes.headers['content-type'];
                    if (contentType && contentType.includes('application/octet-stream')) {
                        // 透传文件流
                        res.writeHead(proxyRes.statusCode || 200, {
                            'Content-Type': contentType,
                            'Content-Disposition': proxyRes.headers['content-disposition'],
                            'Access-Control-Allow-Origin': '*'
                        });
                        proxyRes.pipe(res);
                        responseSent = true;
                        resolve({code: 0, message: '下载成功'});
                        return;
                    }

                    // 如果返回JSON响应，则解析并返回
                    let responseData = '';
                    proxyRes.on('data', chunk => {
                        responseData += chunk
                    });
                    proxyRes.on('end', () => {
                        try {
                            const jsonResponse = JSON.parse(responseData);
                            resolve(jsonResponse);
                        } catch {
                            resolve({code: -1, message: '解析响应失败'});
                        }
                    });
                });

                proxyReq.on('error', (error) => {
                    resolve({code: -1, message: `请求失败: ${error.message}`});
                });

                proxyReq.write(JSON.stringify(params));
                proxyReq.end();
            });

            // 只有在未发送文件流响应时才发送JSON响应
            if (!responseSent) {
                res.json(proxyResult);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : '下载失败';
            res.json({code: -1, message});
        }
    }



    return router;
}

export function ArchiveManagement(
    dataRepo: DataDistributingRepository,
    configRepo: SystemConfigRepository
): Router {

    const router = Router();
    router.get('/', handleGetArchiveManagement); // 查看待归档文件
    router.post('/no-archive', handleBatchNoArchive);// 无需归档操作
    /**
     * 处理获取归档管理文件列表请求
     * GET /archive-management?page=1&pageSize=50&search=xxx&archiveType=pending|core|important|open&importanceLevelFilter=1
     */
    function handleGetArchiveManagement(req: Request, res: Response): void {
        const page = parseInt((req.query.page as string) || '1', 10);
        const pageSize = parseInt((req.query.pageSize as string) || '50', 10);
        const search = req.query.search as string || undefined;
        const archiveType = (req.query.archiveType as string || 'pending') as 'pending' | 'core' | 'important' | 'open';
        const importanceLevelFilterStr = req.query.importanceLevelFilter as string;

        const options: ArchiveQueryOptions = {
            page,
            pageSize,
            search,
            archiveType
        };

        // 如果指定了重要程度过滤参数（仅对 pending 类型有效）
        if (importanceLevelFilterStr && archiveType === 'pending') {
            const importanceLevel = parseInt(importanceLevelFilterStr, 10);
            if (!isNaN(importanceLevel) && importanceLevel >= 1 && importanceLevel <= 3) {
                options.importanceLevelFilter = importanceLevel;
            }
        }

        const result = dataRepo.getArchiveFiles(options);

        res.json({
            success: true,
            data: {
                files: result.files,
                total: result.total,
                page,
                pageSize
            }
        });
    }

    /**
     * 处理批量无需归档请求
     * POST /archive-management/no-archive
     * Body: { ids: number[] }
     */
    async function handleBatchNoArchive(req: Request, res: Response): Promise<void> {
        const params = req.body as { ids: number[] };

        // 验证必填字段
        if (!params.ids || !Array.isArray(params.ids) || params.ids.length === 0) {
            res.status(400).json({success: false, error: 'Missing or invalid required field: ids'});
            return;
        }

        const updatedCount = dataRepo.batchUpdateToNoArchive(params.ids);

        logger.info('ArchiveManagement', '批量设置为无需归档', {count: updatedCount});

        res.json({
            success: true,
            data: {updatedCount},
            message: `成功将 ${updatedCount} 条记录设置为无需归档`
        });
    }
    return router;
}

export default {Archive, ArchiveManagement};
