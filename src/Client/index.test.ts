import TexasScheduler from './index';
import * as Browser from '../Browser';
import * as CaptchaSolver from '../CaptchaSolver';
import * as Log from '../Log';
import prompts from 'prompts';

jest.mock('../Browser');
jest.mock('../CaptchaSolver');
jest.mock('../Log');
jest.mock('prompts');
jest.mock('../Config', () => () => ({
    personalInfo: {
        firstName: 'Test',
        lastName: 'User',
        dob: '01/01/2000',
        lastFourSSN: '1234',
        typeId: 71,
    },
    location: {
        zipCode: ['78701'],
        cityName: [''],
        miles: 50,
        pickDPSLocation: false,
        daysAround: {
            startDate: '2024-01-01',
            start: 0,
            end: 30,
        },
        preferredDays: [],
        timesAround: {
            start: 8,
            end: 17,
        },
        sameDay: false,
    },
    appSettings: {
        interval: 60000,
        webserver: false,
        headersTimeout: 10000,
        maxRetry: 3,
        captcha: {
            strategy: 'solver', // Default strategy for tests
        },
        pushNotifcation: {
            enabled: false,
        },
    },
}));


describe('TexasScheduler', () => {
    let scheduler: TexasScheduler;

    beforeEach(() => {
        // @ts-ignore
        scheduler = new TexasScheduler();
        // Reset mocks before each test
        jest.clearAllMocks();
        // @ts-ignore
        scheduler.config.appSettings.captcha.strategy = 'solver'; // Default
    });

    describe('getAuthToken', () => {
        it('should handle errors from getAuthTokenFromBrowser and not set authToken', async () => {
            // @ts-ignore
            scheduler.config.appSettings.captcha.strategy = 'browser';
            const browserError = new Error('Browser auth error');
            (Browser.getAuthTokenFromBroswer as jest.Mock).mockRejectedValue(browserError);

            // @ts-ignore
            await scheduler.getAuthToken();

            expect(Log.error).toHaveBeenCalledWith('Error getting auth token from browser:', browserError);
            // @ts-ignore
            expect(scheduler.authToken).toBe('');
        });

        it('should handle errors from prompts and not set authToken', async () => {
            // @ts-ignore
            scheduler.config.appSettings.captcha.strategy = 'manual';
            const promptsError = new Error('Prompts error');
            (prompts as unknown as jest.Mock).mockRejectedValue(promptsError);

            // @ts-ignore
            await scheduler.getAuthToken();

            expect(Log.error).toHaveBeenCalledWith('Error getting auth token from prompts:', promptsError);
            // @ts-ignore
            expect(scheduler.authToken).toBe('');
        });

        it('should set authToken if getAuthTokenFromBrowser succeeds', async () => {
            // @ts-ignore
            scheduler.config.appSettings.captcha.strategy = 'browser';
            (Browser.getAuthTokenFromBroswer as jest.Mock).mockResolvedValue('browser-token');
             // @ts-ignore
            await scheduler.getAuthToken();
             // @ts-ignore
            expect(scheduler.authToken).toBe('browser-token');
        });

        it('should set authToken if prompts succeeds', async () => {
            // @ts-ignore
            scheduler.config.appSettings.captcha.strategy = 'manual';
            (prompts as unknown as jest.Mock).mockResolvedValue({ token: 'manual-token' });
            // @ts-ignore
            await scheduler.getAuthToken();
            // @ts-ignore
            expect(scheduler.authToken).toBe('manual-token');
        });
    });

    describe('getCaptchaToken', () => {
        it('should handle errors from CreateCaptchaSolverTask and return null', async () => {
            const captchaError = new Error('Captcha task creation error');
            (CaptchaSolver.CreateCaptchaSolverTask as jest.Mock).mockRejectedValue(captchaError);

            // @ts-ignore
            const token = await scheduler.getCaptchaToken();

            expect(Log.error).toHaveBeenCalledWith('Error creating captcha solver task:', captchaError);
            expect(token).toBeNull();
        });

        it('should retry if GetCaptchaSolverResult returns processing then ready', async () => {
            const mockTaskId = 'mock-task-id';
            (CaptchaSolver.CreateCaptchaSolverTask as jest.Mock).mockResolvedValue(mockTaskId);
            (CaptchaSolver.GetCaptchaSolverResult as jest.Mock)
                .mockResolvedValueOnce({ status: 'processing' })
                .mockResolvedValueOnce({ status: 'ready', solution: { gRecaptchaResponse: 'captcha-token' } });
            jest.spyOn(global, 'setTimeout');
            // @ts-ignore
            const token = await scheduler.getCaptchaToken();

            expect(CaptchaSolver.CreateCaptchaSolverTask).toHaveBeenCalledTimes(1);
            expect(CaptchaSolver.GetCaptchaSolverResult).toHaveBeenCalledTimes(2);
            expect(CaptchaSolver.GetCaptchaSolverResult).toHaveBeenNthCalledWith(1, mockTaskId);
            expect(CaptchaSolver.GetCaptchaSolverResult).toHaveBeenNthCalledWith(2, mockTaskId);
            // @ts-ignore
            expect(global.setTimeout.mock.calls[0][1]).toBe(2000); // Check sleep duration
            expect(token).toBe('captcha-token');
            expect(Log.info).toHaveBeenCalledWith('Captcha token received successfully');
        });


        it('should retry and create new task if GetCaptchaSolverResult returns null (error)', async () => {
            const mockTaskId1 = 'mock-task-id-1';
            const mockTaskId2 = 'mock-task-id-2';
            (CaptchaSolver.CreateCaptchaSolverTask as jest.Mock)
                .mockResolvedValueOnce(mockTaskId1)
                .mockResolvedValueOnce(mockTaskId2); // For the retry

            (CaptchaSolver.GetCaptchaSolverResult as jest.Mock)
                .mockImplementation(async (taskId) => {
                    if (taskId === mockTaskId1) {
                        return null; // Simulate an error or non-ready status
                    }
                    if (taskId === mockTaskId2) {
                        return { status: 'ready', solution: { gRecaptchaResponse: 'captcha-token-2' } };
                    }
                    return undefined;
                });
            jest.spyOn(global, 'setTimeout');
            // @ts-ignore
            scheduler.maxCaptchaSolverRetries = 1; // Limit retries for this test

            // @ts-ignore
            const token = await scheduler.getCaptchaToken();

            expect(CaptchaSolver.CreateCaptchaSolverTask).toHaveBeenCalledTimes(2);
            expect(CaptchaSolver.GetCaptchaSolverResult).toHaveBeenCalledWith(mockTaskId1);
            expect(CaptchaSolver.GetCaptchaSolverResult).toHaveBeenCalledWith(mockTaskId2);
            expect(Log.error).toHaveBeenCalledWith('get captcha token failed! will create new task and sleep 10s!');
             // @ts-ignore
            expect(global.setTimeout.mock.calls[0][1]).toBe(10000); // Check sleep duration
            expect(token).toBe('captcha-token-2');
            expect(Log.info).toHaveBeenCalledWith('Captcha token received successfully');
        });


        it('should return null if GetCaptchaSolverResult throws an error', async () => {
            const mockTaskId = 'mock-task-id';
            const getResultError = new Error('GetCaptchaResult error');
            (CaptchaSolver.CreateCaptchaSolverTask as jest.Mock).mockResolvedValue(mockTaskId);
            (CaptchaSolver.GetCaptchaSolverResult as jest.Mock).mockRejectedValue(getResultError);
            // @ts-ignore
            const token = await scheduler.getCaptchaToken();

            expect(CaptchaSolver.CreateCaptchaSolverTask).toHaveBeenCalledTimes(1);
            expect(CaptchaSolver.GetCaptchaSolverResult).toHaveBeenCalledWith(mockTaskId);
            // @ts-ignore
            expect(scheduler.getCaptchaResult(mockTaskId)).resolves.toBeNull(); // Check the inner method
        });

        it('should reach max retries and then retry from scratch if always processing', async () => {
            const mockTaskId = 'mock-task-id-initial';
            const mockTaskIdRetry = 'mock-task-id-retry';

            (CaptchaSolver.CreateCaptchaSolverTask as jest.Mock)
                .mockResolvedValueOnce(mockTaskId)
                .mockResolvedValueOnce(mockTaskIdRetry); // This will be called after max retries

            (CaptchaSolver.GetCaptchaSolverResult as jest.Mock)
                .mockImplementation(async (taskId) => {
                    if (taskId === mockTaskId) {
                        return { status: 'processing' }; // Always processing for the first task ID
                    }
                    if (taskId === mockTaskIdRetry) {
                        return { status: 'ready', solution: { gRecaptchaResponse: 'captcha-token-success-after-retry' } };
                    }
                    return undefined;
                });

            jest.spyOn(global, 'setTimeout');
            // @ts-ignore
            scheduler.maxCaptchaSolverRetries = 2; // Set low for testing

            // @ts-ignore
            const token = await scheduler.getCaptchaToken();

            expect(CaptchaSolver.CreateCaptchaSolverTask).toHaveBeenCalledTimes(2);
            expect(CaptchaSolver.GetCaptchaSolverResult).toHaveBeenCalledWith(mockTaskId); // Called maxCaptchaSolverRetries + 1 times
            expect(CaptchaSolver.GetCaptchaSolverResult).toHaveBeenCalledWith(mockTaskIdRetry); // Called once
            expect(Log.error).toHaveBeenCalledWith(`Get captcha token failed after 2 retries! will retry!`);
            expect(token).toBe('captcha-token-success-after-retry');
        });
    });
});
