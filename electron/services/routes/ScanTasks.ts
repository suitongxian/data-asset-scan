import {Router, Request, Response} from 'express';
import {ScanTaskRepository} from "../ScanTaskRepository";

/**
 * 扫描任务路由
 * 处理 /scan-tasks 路径下的任务列表和详情查询
 */
export function ScanTasks(scanTaskRepo: ScanTaskRepository): Router {

  const router = Router();

  router.get('/', handleGetScanTasks)
  router.get('/:id', handleGetScanTaskDetail)

  /**
   * 处理获取扫描任务列表请求
   * GET /scan-tasks?page=1&pageSize=20
   */
  function handleGetScanTasks(req: Request, res: Response): void {
    const page = parseInt(req.query.page as string || '1', 10)
    const pageSize = parseInt(req.query.pageSize as string || '20', 10)

    const result = scanTaskRepo.getTasksWithPagination({ page, pageSize })

    res.json({
      success: true,
      data: result
    })
  }

  /**
   * 处理获取扫描任务详情请求
   * GET /scan-tasks/:id
   */
  function handleGetScanTaskDetail(req: Request, res: Response): void {
    const taskId = parseInt(req.params.id as string, 10)

    if (isNaN(taskId)) {
      res.status(400).json({ success: false, error: 'Invalid task ID' })
      return
    }

    const task = scanTaskRepo.getTaskDetailById(taskId)

    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' })
      return
    }

    res.json({
      success: true,
      data: task
    })
  }

  return router;
}

export default ScanTasks;
