import {Router, Request, Response} from 'express';
import {UserInfoRepository} from "../UserInfoRepository.ts";
import {getLogger} from "../LoggerService";

const logger = getLogger();

type TerminalRegistrationCallback = (userInfo: { user_name: string; user_department: string; user_unit: string }) => Promise<void>;

export function UserInfo(userInfoRepo: UserInfoRepository,
                         onUserSaved?: TerminalRegistrationCallback): Router {

    const router = Router();

    router.get('/', handleGetUserInfo);
    router.post('/', handleSaveUserInfo);

    /**
     * 处理获取用户信息请求
     * GET /user-info
     */
    function handleGetUserInfo(req: Request, res: Response): void {
        const userInfo = userInfoRepo.getActiveUser();
        res.json({
            success: true,
            data: userInfo
        });
    }

    /**
     * 处理保存用户信息请求
     * POST /user-info
     */
    async function handleSaveUserInfo(req: Request, res: Response): Promise<void> {
        const params = req.body as { company_name: string, user_name: string, department: string, phone?: string | null, work_address?: string | null };
        // 验证必填字段
        if (!params.company_name || !params.user_name || !params.department) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: company_name, user_name, department'
            });
            return;
        }

        const userInfo = userInfoRepo.save({
            company_name: params.company_name,
            user_name: params.user_name,
            department: params.department,
            phone: params.phone,
            work_address: params.work_address
        });

        // 在后台执行终端注册和同步（不阻塞响应）
        // 如果未配置上传服务器地址，只会记录日志，不会抛出错误
        if (onUserSaved) {
            onUserSaved({
                user_name: params.user_name,
                user_department: params.department,
                user_unit: params.company_name
            }).catch(error => {
                logger.error('UserInfo', '终端注册执行失败', error);
            });
        }

        res.json({
            success: true,
            data: userInfo,
            message: '用户信息已保存'
        });
    }

    return router;
}

export default UserInfo;
