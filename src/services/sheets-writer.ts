import { google, sheets_v4 } from "googleapis";
import { GoogleAuthService } from "./google-auth-service.js";
import { getGoogleSheetsConfigInstance } from "#config/google-sheets.js";
import { getServiceLogger } from "#utils/logger.js";

const logger = getServiceLogger("SheetsWriter");

/** Интерфейс для результатов операции */
interface OperationResult {
    success: boolean;
    spreadsheetId: string;
    range?: string;
    rowsCount?: number;
    error?: string;
    duration?: number;
}

/** Интерфейс для настроек повторных попыток */
interface RetryOptions {
    maxRetries: number;
    baseDelay: number; // Базовая задержка в мс
    maxDelay: number; // Максимальная задержка в мс
    backoffFactor: number; // Множитель для экспоненциального бэкоффа
}

/** Класс для работы с Google Sheets API Реализует методы для очистки, пакетного обновления и добавления данных */
export class SheetsWriter {
    private static instance: SheetsWriter;
    private sheetsService: sheets_v4.Sheets | null = null;
    private config = getGoogleSheetsConfigInstance();
    private readonly defaultRetryOptions: RetryOptions = {
        maxRetries: 3,
        baseDelay: 1000, // 1 секунда
        maxDelay: 30000, // 30 секунд
        backoffFactor: 2,
    };

    private constructor() {
        this.initializeSheetsService();
    }

    /** Получение singleton экземпляра сервиса */
    public static getInstance(): SheetsWriter {
        if (!SheetsWriter.instance) {
            SheetsWriter.instance = new SheetsWriter();
        }
        return SheetsWriter.instance;
    }

    /** Инициализация сервиса Google Sheets */
    private async initializeSheetsService(): Promise<void> {
        try {
            const authService = GoogleAuthService.getInstance();
            const authClient = await authService.getAuthClient();

            this.sheetsService = google.sheets({ version: "v4", auth: authClient });

            logger.info("Сервис Google Sheets успешно инициализирован", {
                projectId: this.config.getProjectId(),
                serviceAccount: this.config.getServiceAccountEmail(),
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Ошибка инициализации сервиса Google Sheets", { error: errorMessage });
            throw new Error(`Не удалось инициализировать сервис Google Sheets: ${errorMessage}`);
        }
    }

    /** Получение экземпляра сервиса Sheets с проверкой инициализации */
    private async getSheetsService(): Promise<sheets_v4.Sheets> {
        if (!this.sheetsService) {
            await this.initializeSheetsService();
        }
        return this.sheetsService!;
    }

    /** Получение полного диапазона с именем листа по умолчанию */
    private getFullRange(range?: string): string {
        const defaultSheetName = this.config.getDefaultSheetName();
        if (!range) {
            return `${defaultSheetName}!A:Z`;
        }

        // Если диапазон уже содержит имя листа, возвращаем как есть
        if (range.includes("!")) {
            return range;
        }

        // Иначе добавляем имя листа по умолчанию
        return `${defaultSheetName}!${range}`;
    }

    /** Выполнение операции с механизмом повторных попыток */
    private async executeWithRetry<T>(
        operation: () => Promise<T>,
        operationName: string,
        spreadsheetId: string,
        retryOptions: Partial<RetryOptions> = {},
    ): Promise<T> {
        const options = { ...this.defaultRetryOptions, ...retryOptions };
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = Math.min(options.baseDelay * Math.pow(options.backoffFactor, attempt - 1), options.maxDelay);

                    logger.warn(`Повторная попытка операции ${operationName}`, {
                        spreadsheetId,
                        attempt,
                        maxRetries: options.maxRetries,
                        delay,
                    });

                    await this.sleep(delay);
                }

                return await operation();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                logger.warn(`Ошибка при выполнении операции ${operationName}`, {
                    spreadsheetId,
                    attempt,
                    maxRetries: options.maxRetries,
                    error: lastError.message,
                });

                // Если это последняя попытка, выбрасываем ошибку
                if (attempt === options.maxRetries) {
                    break;
                }

                // Проверяем, стоит ли повторять операцию для данного типа ошибки
                if (!this.shouldRetry(lastError)) {
                    break;
                }
            }
        }

        logger.error(`Операция ${operationName} не удалась после всех попыток`, {
            spreadsheetId,
            maxRetries: options.maxRetries,
            error: lastError?.message,
        });

        throw lastError || new Error(`Операция ${operationName} не удалась`);
    }

    /** Проверка, стоит ли повторять операцию для данного типа ошибки */
    private shouldRetry(error: Error): boolean {
        const errorMessage = error.message.toLowerCase();

        // Повторяем при временных ошибках сети
        if (errorMessage.includes("timeout") || errorMessage.includes("network")) {
            return true;
        }

        // Повторяем при ошибках 429 (Too Many Requests) и 5xx
        if (errorMessage.includes("429") || errorMessage.includes("500") || errorMessage.includes("502") || errorMessage.includes("503")) {
            return true;
        }

        // Повторяем при ошибках квот
        if (errorMessage.includes("quota") || errorMessage.includes("rate limit")) {
            return true;
        }

        return false;
    }

    /** Функция задержки */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Очистка листа или диапазона
     *
     * @param spreadsheetId ID таблицы
     * @param range Диапазон для очистки (например, 'A1:Z1000' или 'Лист1!A:Z')
     * @returns Результат операции
     */
    public async clear(spreadsheetId: string, range: string): Promise<OperationResult> {
        const startTime = Date.now();
        const fullRange = this.getFullRange(range);

        logger.info("Начало операции очистки диапазона", {
            spreadsheetId,
            range: fullRange,
        });

        try {
            const sheetsService = await this.getSheetsService();

            const result = await this.executeWithRetry(
                async () => {
                    const response = await sheetsService.spreadsheets.values.clear({
                        spreadsheetId,
                        range: fullRange,
                    });

                    return response.data;
                },
                "clear",
                spreadsheetId,
            );

            const duration = Date.now() - startTime;

            logger.info("Операция очистки диапазона завершена успешно", {
                spreadsheetId,
                range: fullRange,
                clearedRange: result.clearedRange,
                duration,
            });

            return {
                success: true,
                spreadsheetId,
                range: fullRange,
                duration,
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            logger.error("Ошибка при очистке диапазона", {
                spreadsheetId,
                range: fullRange,
                error: errorMessage,
                duration,
            });

            return {
                success: false,
                spreadsheetId,
                range: fullRange,
                error: errorMessage,
                duration,
            };
        }
    }

    /**
     * Пакетное обновление данных
     *
     * @param spreadsheetId ID таблицы
     * @param data Двумерный массив данных для записи
     * @param range Диапазон для записи (опционально)
     * @returns Результат операции
     */
    public async batchUpdate(spreadsheetId: string, data: any[][], range?: string): Promise<OperationResult> {
        const startTime = Date.now();
        const fullRange = this.getFullRange(range);
        const rowsCount = data.length;

        logger.info("Начало операции пакетного обновления", {
            spreadsheetId,
            range: fullRange,
            rowsCount,
        });

        try {
            const sheetsService = await this.getSheetsService();

            const result = await this.executeWithRetry(
                async () => {
                    const response = await sheetsService.spreadsheets.values.update({
                        spreadsheetId,
                        range: fullRange,
                        valueInputOption: "USER_ENTERED",
                        requestBody: {
                            values: data,
                        },
                    });

                    return response;
                },
                "batchUpdate",
                spreadsheetId,
            );

            const duration = Date.now() - startTime;

            logger.info("Операция пакетного обновления завершена успешно", {
                spreadsheetId,
                range: fullRange,
                rowsCount,
                updatedRows: result.data.updatedRows,
                updatedColumns: result.data.updatedColumns,
                updatedCells: result.data.updatedCells,
                duration,
            });

            return {
                success: true,
                spreadsheetId,
                range: fullRange,
                rowsCount,
                duration,
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            logger.error("Ошибка при пакетном обновлении", {
                spreadsheetId,
                range: fullRange,
                rowsCount,
                error: errorMessage,
                duration,
            });

            return {
                success: false,
                spreadsheetId,
                range: fullRange,
                rowsCount,
                error: errorMessage,
                duration,
            };
        }
    }

    /**
     * Добавление строк в таблицу
     *
     * @param spreadsheetId ID таблицы
     * @param values Двумерный массив значений для добавления
     * @param range Диапазон для добавления (опционально)
     * @returns Результат операции
     */
    public async append(spreadsheetId: string, values: any[][], range?: string): Promise<OperationResult> {
        const startTime = Date.now();
        const fullRange = this.getFullRange(range);
        const rowsCount = values.length;

        logger.info("Начало операции добавления строк", {
            spreadsheetId,
            range: fullRange,
            rowsCount,
        });

        try {
            const sheetsService = await this.getSheetsService();

            const result = await this.executeWithRetry(
                async () => {
                    const response = await sheetsService.spreadsheets.values.append({
                        spreadsheetId,
                        range: fullRange,
                        valueInputOption: "USER_ENTERED",
                        requestBody: {
                            values: values,
                        },
                    });

                    return response;
                },
                "append",
                spreadsheetId,
            );

            const duration = Date.now() - startTime;

            logger.info("Операция добавления строк завершена успешно", {
                spreadsheetId,
                range: fullRange,
                rowsCount,
                updatedRows: result.data.updates?.updatedRows,
                updatedColumns: result.data.updates?.updatedColumns,
                updatedCells: result.data.updates?.updatedCells,
                duration,
            });

            return {
                success: true,
                spreadsheetId,
                range: fullRange,
                rowsCount,
                duration,
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            logger.error("Ошибка при добавлении строк", {
                spreadsheetId,
                range: fullRange,
                rowsCount,
                error: errorMessage,
                duration,
            });

            return {
                success: false,
                spreadsheetId,
                range: fullRange,
                rowsCount,
                error: errorMessage,
                duration,
            };
        }
    }

    /**
     * Выполнение операции над несколькими таблицами
     *
     * @param operation Операция для выполнения
     * @param data Данные для операции (если применимо)
     * @param range Диапазон (если применимо)
     * @returns Массив результатов для каждой таблицы
     */
    public async executeOnAllSpreadsheets(operation: "clear" | "batchUpdate" | "append", data?: any[][], range?: string): Promise<OperationResult[]> {
        const spreadsheetIds = this.config.getSheetIds();
        const results: OperationResult[] = [];

        logger.info("Начало выполнения операции над всеми таблицами", {
            operation,
            spreadsheetCount: spreadsheetIds.length,
            spreadsheetIds,
        });

        for (const spreadsheetId of spreadsheetIds) {
            try {
                let result: OperationResult;

                switch (operation) {
                    case "clear":
                        result = await this.clear(spreadsheetId, range || "A:Z");
                        break;
                    case "batchUpdate":
                        result = await this.batchUpdate(spreadsheetId, data || [], range);
                        break;
                    case "append":
                        result = await this.append(spreadsheetId, data || [], range);
                        break;
                    default:
                        throw new Error(`Неизвестная операция: ${operation}`);
                }

                results.push(result);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                logger.error("Ошибка при выполнении операции над таблицей", {
                    operation,
                    spreadsheetId,
                    error: errorMessage,
                });

                results.push({
                    success: false,
                    spreadsheetId,
                    error: errorMessage,
                });
            }
        }

        const successCount = results.filter((r) => r.success).length;
        const failureCount = results.length - successCount;

        logger.info("Выполнение операции над всеми таблицами завершено", {
            operation,
            total: results.length,
            success: successCount,
            failures: failureCount,
        });

        return results;
    }
}

// Экспорт функций для удобного доступа к сервису
export function getSheetsWriter(): SheetsWriter {
    return SheetsWriter.getInstance();
}

// Экспорт по умолчанию для совместимости
export default SheetsWriter.getInstance();
