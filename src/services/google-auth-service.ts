import { google, Auth } from "googleapis";
import { getGoogleCredentials, getGoogleSheetsConfig } from "#config/env/env.js";
import { getServiceLogger } from "#utils/logger.js";

const logger = getServiceLogger("GoogleAuthService");

/** Интерфейс для хранения информации о токене */
interface TokenInfo {
    accessToken: string;
    expiryDate: number; // Timestamp в миллисекундах
}

/** Сервис для авторизации в Google API через сервисный аккаунт Реализует кеширование токена доступа с автоматическим обновлением */
export class GoogleAuthService {
    private static instance: GoogleAuthService;
    private jwtClient: Auth.JWT | null = null;
    private tokenInfo: TokenInfo | null = null;
    private readonly TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 минут до истечения токена

    private constructor() {
        this.initializeAuthClient();
    }

    /** Получение singleton экземпляра сервиса */
    public static getInstance(): GoogleAuthService {
        if (!GoogleAuthService.instance) {
            GoogleAuthService.instance = new GoogleAuthService();
        }
        return GoogleAuthService.instance;
    }

    /** Инициализация JWT клиента для авторизации */
    private initializeAuthClient(): void {
        try {
            const config = getGoogleSheetsConfig();
            const credentials = config.credentials;

            this.jwtClient = new Auth.JWT(
                credentials.client_email,
                undefined, // keyFile
                credentials.private_key,
                config.appScopes,
                undefined, // subject
            );

            logger.info("JWT клиент для Google API успешно инициализирован", {
                email: credentials.client_email,
                scopes: config.appScopes,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Ошибка инициализации JWT клиента", { error: errorMessage });
            throw new Error(`Не удалось инициализировать JWT клиент: ${errorMessage}`);
        }
    }

    /**
     * Получение аутентифицированного клиента Google API
     *
     * @returns {JWT} Аутентифицированный JWT клиент
     */
    public async getAuthClient(): Promise<Auth.JWT> {
        if (!this.jwtClient) {
            throw new Error("JWT клиент не инициализирован");
        }

        // Проверяем валидность токена и обновляем при необходимости
        if (!this.isTokenValid()) {
            await this.refreshToken();
        }

        return this.jwtClient;
    }

    /**
     * Проверка валидности токена доступа
     *
     * @returns {boolean} True если токен валиден, иначе false
     */
    public isTokenValid(): boolean {
        if (!this.tokenInfo) {
            return false;
        }

        const now = Date.now();
        const isValid = Boolean(this.tokenInfo.accessToken && this.tokenInfo.expiryDate > now + this.TOKEN_REFRESH_THRESHOLD_MS);

        if (!isValid) {
            logger.debug("Токен доступа недействителен или скоро истечет", {
                expiryDate: new Date(this.tokenInfo.expiryDate).toISOString(),
                now: new Date(now).toISOString(),
                threshold: this.TOKEN_REFRESH_THRESHOLD_MS,
            });
        }

        return isValid;
    }

    /**
     * Принудительное обновление токена доступа
     *
     * @returns {Promise<void>}
     */
    public async refreshToken(): Promise<void> {
        if (!this.jwtClient) {
            throw new Error("JWT клиент не инициализирован");
        }

        try {
            logger.info("Запуск обновления токена доступа");

            // Получаем новые учетные данные
            const response = await this.jwtClient.authorize();

            if (!response.access_token) {
                throw new Error("В ответе отсутствует access_token");
            }

            // Обновляем информацию о токене
            this.tokenInfo = {
                accessToken: response.access_token,
                expiryDate: response.expiry_date || Date.now() + 3600 * 1000, // По умолчанию 1 час
            };

            logger.info("Токен доступа успешно обновлен", {
                expiryDate: new Date(this.tokenInfo.expiryDate).toISOString(),
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Ошибка обновления токена доступа", { error: errorMessage });

            // Сбрасываем информацию о токене при ошибке
            this.tokenInfo = null;

            throw new Error(`Не удалось обновить токен доступа: ${errorMessage}`);
        }
    }

    /**
     * Получение текущего токена доступа
     *
     * @returns {string | null} Токен доступа или null если отсутствует
     */
    public getCurrentAccessToken(): string | null {
        return this.tokenInfo?.accessToken || null;
    }

    /**
     * Получение времени истечения токена
     *
     * @returns {Date | null} Дата истечения токена или null если отсутствует
     */
    public getTokenExpiryDate(): Date | null {
        return this.tokenInfo ? new Date(this.tokenInfo.expiryDate) : null;
    }

    /** Сброс кешированного токена (полезно для тестирования) */
    public resetToken(): void {
        logger.info("Сброс кешированного токена доступа");
        this.tokenInfo = null;
    }

    /**
     * Проверка доступности Google API
     *
     * @returns {Promise<boolean>} True если API доступен, иначе false
     */
    public async checkApiAvailability(): Promise<boolean> {
        try {
            const client = await this.getAuthClient();
            // Простая проверка - пытаемся получить информацию о проекте
            await client.request({
                url: "https://www.googleapis.com/oauth2/v1/tokeninfo",
                params: {
                    access_token: this.getCurrentAccessToken(),
                },
            });

            logger.info("Проверка доступности Google API прошла успешно");
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Проверка доступности Google API не удалась", { error: errorMessage });
            return false;
        }
    }
}

// Экспорт функций для удобного доступа к сервису
export function getGoogleAuthService(): GoogleAuthService {
    return GoogleAuthService.getInstance();
}

export async function getAuthenticatedGoogleClient(): Promise<Auth.JWT> {
    const service = GoogleAuthService.getInstance();
    return await service.getAuthClient();
}

// Экспорт по умолчанию для совместимости
export default GoogleAuthService.getInstance();
