import {Router, Request, Response} from 'express';
import {FileStatisticsRepository} from "../FileStatisticsRepository.ts";

export function Statistics(statsRepo: FileStatisticsRepository): Router {

    const router = Router();

    router.get('/', handleGetStatistics)

    /**
     * 处理获取文件统计数据请求
     * GET /statistics
     * 返回最近两次扫描的统计对比数据
     */
    function handleGetStatistics(req: Request, res: Response): void {
        const comparison = statsRepo.getStatisticsComparison()

        res.json({
            success: true,
            data: comparison
        })
    }

    return router;
}

export default Statistics;
