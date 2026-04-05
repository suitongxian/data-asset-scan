import {Router, Request, Response} from 'express';
import {DataResourcesRepository, DataResourcesQueryParams} from "../DataResourcesRepository.ts";
import {SystemConfigRepository} from "../SystemConfigRepository.ts";
import {ResourceClassifyService, ClassifyParams} from "../ResourceClassifyService";

export function Resources(
    dataResourcesRepo: DataResourcesRepository,
    configRepo: SystemConfigRepository,
    classifyService: ResourceClassifyService
): Router {

    const router = Router();

    router.get('/', handleGetResources)
    router.get('/statistics', handleGetResourcesStatistics)
    router.post('/claim', handleBatchClaim)
    router.post('/classify', handleBatchClassify)
    router.post('/classify/single', handleSingleClassify)

    /**
     * 处理获取信息资源列表请求
     * GET /resources?page=1&pageSize=50&claimStatusFilter=0&importanceLevelFilter=0&search=xxx&businessTypeFilter=workspace|new_access|history_inventory
     */
    function handleGetResources(req: Request, res: Response): void {
        const page = parseInt((req.query.page as string) || '1', 10)
        const pageSize = parseInt((req.query.pageSize as string) || '50', 10)
        const claimStatusFilterStr = req.query.claimStatusFilter as string
        const claimStatusInStr = req.query.claimStatusIn as string
        const importanceLevelFilterStr = req.query.importanceLevelFilter as string
        const businessTypeFilterStr = req.query.businessTypeFilter as string
        const search = (req.query.search as string) || undefined

        // 使用 != null 检查，同时处理 undefined 和 null
        const claimStatusFilter = claimStatusFilterStr != null ? parseInt(claimStatusFilterStr, 10) : undefined
        const importanceLevelFilter = importanceLevelFilterStr != null ? parseInt(importanceLevelFilterStr, 10) : undefined

        // 解析 claimStatusIn 参数（逗号分隔的数字列表）
        let claimStatusIn: number[] | undefined
        if (claimStatusInStr) {
            claimStatusIn = claimStatusInStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
            if (claimStatusIn.length === 0) {
                claimStatusIn = undefined
            }
        }

        // 处理业务类型过滤参数
        let businessTypeFilter: 'workspace' | 'new_access' | 'history_inventory' | null = null
        if (businessTypeFilterStr && ['workspace', 'new_access', 'history_inventory'].includes(businessTypeFilterStr)) {
            businessTypeFilter = businessTypeFilterStr as 'workspace' | 'new_access' | 'history_inventory'
        }

        // 获取历史封帐时间
        const fullInventoryTime = configRepo.getFullInventoryTime()

        const queryParams: DataResourcesQueryParams = {
            page,
            pageSize,
            claimStatusFilter,
            claimStatusIn,
            importanceLevelFilter,
            search,
            businessTypeFilter,
            fullInventoryTime: fullInventoryTime || undefined
        }

        const result = dataResourcesRepo.getResourcesWithPagination(queryParams)

        res.json({
            success: true,
            data: result
        })
    }

    /**
     * 处理批量认领请求
     * POST /resources/claim
     * Body: { ids: number[], is_claimed: number, claim_status: number, claimant_name: string, claimant_unit: string }
     */
    async function handleBatchClaim(req: Request, res: Response): Promise<void> {
        const params = req.body as {
            ids: number[]
            is_claimed: number
            claim_status: number
            claimant_name: string
            claimant_unit: string
        }

        // 验证必填字段
        if (!params.ids || !Array.isArray(params.ids) || params.ids.length === 0) {
            res.status(400).json({ success: false, error: 'Missing or invalid required field: ids' })
            return
        }
        if (params.is_claimed === undefined || params.claim_status === undefined) {
            res.status(400).json({ success: false, error: 'Missing required fields: is_claimed, claim_status' })
            return
        }
        if (!params.claimant_name || !params.claimant_unit) {
            res.status(400).json({ success: false, error: 'Missing required fields: claimant_name, claimant_unit' })
            return
        }

        const updatedCount = dataResourcesRepo.batchClaim({
            ids: params.ids,
            is_claimed: params.is_claimed,
            claim_status: params.claim_status,
            claimant_name: params.claimant_name,
            claimant_unit: params.claimant_unit
        })

        res.json({
            success: true,
            data: { updatedCount },
            message: `成功认领 ${updatedCount} 条资源`
        })
    }

    /**
     * 处理批量归类保护请求
     * POST /resources/classify
     * Body: { ids: number[], importance_level: number }
     */
    async function handleBatchClassify(req: Request, res: Response): Promise<void> {
        const params = req.body as {
            ids: number[]
            importance_level: number
        }

        // 验证必填字段
        if (!params.ids || !Array.isArray(params.ids) || params.ids.length === 0) {
            res.status(400).json({ success: false, error: 'Missing or invalid required field: ids' })
            return
        }
        if (params.importance_level === undefined) {
            res.status(400).json({ success: false, error: 'Missing required field: importance_level' })
            return
        }

        // 验证重要程度值范围 (0-4)
        if (params.importance_level < 0 || params.importance_level > 4) {
            res.status(400).json({ success: false, error: 'Invalid importance_level value. Valid values: 0-4' })
            return
        }

        const updatedCount = dataResourcesRepo.batchClassify({
            ids: params.ids,
            importance_level: params.importance_level
        })

        res.json({
            success: true,
            data: { updatedCount },
            message: `成功归类 ${updatedCount} 条资源`
        })
    }

    /**
     * 处理单条归类保护请求
     * POST /resources/classify/single
     * Body: {
     *   data_resources_id: number,
     *   importance_level: number,
     *   resources_name?: string,
     *   resources_desc?: string,
     *   content_subject?: string
     * }
     */
    async function handleSingleClassify(req: Request, res: Response): Promise<void> {
        const params: ClassifyParams = req.body

        // 验证必填字段
        if (!params.data_resources_id || params.importance_level === undefined) {
            res.status(400).json({ success: false, error: 'Missing required fields: data_resources_id, importance_level' })
            return
        }

        // 验证重要程度值范围 (1-3, 5)
        const validValues = [1, 2, 3, 5]
        if (!validValues.includes(params.importance_level)) {
            res.status(400).json({ success: false, error: 'Invalid importance_level value. Valid values: 1, 2, 3, 5' })
            return
        }

        const result = await classifyService.classifyResource(params)

        res.json(result)
    }

    /**
     * 处理获取信息资源统计请求
     * GET /resources/statistics
     * 返回基于 data_resources 表的统计数据
     */
    function handleGetResourcesStatistics(req: Request, res: Response): void {
        // 获取历史封帐时间
        const fullInventoryTime = configRepo.getFullInventoryTime()

        const statistics = dataResourcesRepo.getResourcesStatistics(fullInventoryTime || null)

        res.json({
            success: true,
            data: statistics
        })
    }

    return router;
}

export default Resources;
