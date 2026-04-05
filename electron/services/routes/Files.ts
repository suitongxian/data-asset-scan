import {Router, Request, Response} from 'express';
import {DataDistributingRepository} from "../DataDistributingRepository.ts";
import {SystemConfigRepository} from "../SystemConfigRepository.ts";
import {FileOpenerService, OpenFileResult} from "../FileOpenerService";

export function Files(configRepo: SystemConfigRepository, dataRepo: DataDistributingRepository, fileOpenerService: FileOpenerService | null): Router {

    const router = Router();

    router.get('/', handleGetFiles)
    router.get('/:contentSign/copies', handleGetCopies)
    router.post('/open', handleOpenFile)

    /**
     * 处理获取文件列表请求
     * GET /files?search=xxx&workspaceFilter=inside&survivalFilter=new&page=1&pageSize=50
     */
    function handleGetFiles(req: Request, res: Response): void {
        const search = req.query.search as string || undefined
        const workspaceFilter = (req.query.workspaceFilter as string || 'all') as 'inside' | 'outside' | 'all'
        const survivalFilter = (req.query.survivalFilter as string || 'all') as 'new' | 'deleted' | 'normal' | 'all'
        const page = parseInt(req.query.page as string || '1', 10)
        const pageSize = parseInt(req.query.pageSize as string || '50', 10)
        // 已作废
        const noPagination = req.query.noPagination === 'true'
        const workspacePath = configRepo.getWorkspace() || undefined
        // 分页查询
        const result = dataRepo.getFilesWithPagination({
            page,
            pageSize,
            search,
            workspacePath,
            workspaceFilter,
            survivalFilter
        })
        res.json({
            success: true, data: {
                files: result.files,
                total: result.total,
                page,
                pageSize
            }
        });
    }


    /**
     * 处理获取副本列表请求
     * GET /files/:contentSign/copies
     */
    function handleGetCopies(req: Request, res: Response): void {
        console.log("读取副本数")
        const contentSign = req.params.contentSign as string;
        const copies = dataRepo.getCopiesByContentSign(decodeURIComponent(contentSign))
        res.json({
            success: true,
            data: {
                copies, count: copies.length
            }
        })
    }

    /**
     * 处理打开文件请求
     * POST /files/open
     * Body: { contentSign: string }
     */
    async function handleOpenFile(req: Request, res: Response): Promise<void> {
        if (!fileOpenerService) {
            res.status(503).json({ success: false, error: 'File opener service not available' });
            return;
        }

        const params = req.body as { contentSign: string };

        // 验证必填字段
        if (!params.contentSign) {
            res.status(400).json({ success: false, error: 'Missing required field: contentSign' });
            return;
        }

        const result: OpenFileResult = await fileOpenerService.openFileByContentSign(params.contentSign);

        res.json({
            success: result.success,
            message: result.message,
            data: result.filePath ? { filePath: result.filePath } : undefined
        });
    }

    return router;
}

export default Files;
