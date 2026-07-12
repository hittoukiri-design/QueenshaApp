import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { triggerCloudBackup } from './backupEngine';

export const BACKUP_TASK_NAME = 'BACKGROUND_AUTO_BACKUP_TASK';

// Define the background task for the OS
TaskManager.defineTask(BACKUP_TASK_NAME, async () => {
  try {
    console.log('Background Auto Backup Task started...');
    const result = await triggerCloudBackup();
    if (result.success) {
      console.log('Background Auto Backup Task finished successfully:', result);
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } else {
      console.error('Background Auto Backup Task failed:', result.error);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  } catch (error) {
    console.error('Background Auto Backup Task critical error:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Register background task to run every 12 hours (or when standby/charging).
 */
export const registerBackgroundBackupTask = async () => {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKUP_TASK_NAME);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(BACKUP_TASK_NAME, {
        minimumInterval: 60 * 60 * 12, // 12 hours
        stopOnTerminate: false, // keep running after app close
        startOnBoot: true, // start when device restarts
      });
      console.log('Background Auto Backup Task registered successfully.');
    } else {
      console.log('Background Auto Backup Task is already registered.');
    }
  } catch (err) {
    console.error('Failed to register Background Auto Backup Task:', err);
  }
};

/**
 * Unregister background task.
 */
export const unregisterBackgroundBackupTask = async () => {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKUP_TASK_NAME);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKUP_TASK_NAME);
      console.log('Background Auto Backup Task unregistered.');
    }
  } catch (err) {
    console.error('Failed to unregister Background Auto Backup Task:', err);
  }
};
