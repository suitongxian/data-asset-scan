import {Router, Request, Response} from 'express';
import {SystemConfigRepository} from "../SystemConfigRepository.ts";
import * as os from 'node:os';
import {getLogger} from "../LoggerService";

const logger = getLogger();

export function Config(configRepo: SystemConfigRepository): Router {

    const router = Router();

    router.get('/', handleGetConfig);
    router.post('/', handleSaveConfig);

    /**
     * 处理获取配置请求
     * GET /config
     */
    function handleGetConfig(req: Request, res: Response): void {

        const config = {
            workspace: configRepo.getWorkspace(),
            full_inventory_time: configRepo.getFullInventoryTime(),
            daily_scan_interval: configRepo.getDailyScanInterval(),
            last_scan_time: configRepo.getLastScanTime(),
            control_type: configRepo.getControlType(),
            scan_area_path: configRepo.getScanAreaPath(),
            scan_exclude_dir: configRepo.getScanExcludeDir(),
            upload_server_url: configRepo.getUploadServerUrl(),
            last_sync_time: configRepo.getLastSyncTime(),
            home_dir: os.homedir()
        };
        res.json({
            success: true,
            data: config
        });
    }

    /**
     * 处理保存配置请求
     * POST /config
     */
    function handleSaveConfig(req: Request, res: Response): void {
        const config = req.body;
        // 更新配置
        if (config.workspace !== undefined && config.workspace !== null) {
            configRepo.setWorkspace(String(config.workspace));
        }
        if (config.daily_scan_interval !== undefined && config.daily_scan_interval !== null) {
            configRepo.setDailyScanInterval(Number(config.daily_scan_interval));
        }
        if (config.control_type !== undefined && config.control_type !== null) {
            configRepo.setControlType(String(config.control_type));
        }
        if (config.scan_area_path !== undefined && config.scan_area_path !== null) {
            configRepo.setScanAreaPath(String(config.scan_area_path));
        }
        if (config.scan_exclude_dir !== undefined && config.scan_exclude_dir !== null) {
            configRepo.setScanExcludeDir(String(config.scan_exclude_dir));
        }
        if (config.upload_server_url !== undefined && config.upload_server_url !== null) {
            configRepo.setUploadServerUrl(String(config.upload_server_url));
        }

        logger.info('HttpScanService', '配置已保存', { config });
        res.json({
            success: true,
            message: 'Configuration saved'
        });
    }

    return router;
}

export default Config;
