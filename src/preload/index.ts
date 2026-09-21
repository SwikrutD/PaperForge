import { contextBridge } from 'electron';
import { createBridge } from './api';

/** The only global PaperForge adds to the renderer world. */
contextBridge.exposeInMainWorld('paperforge', createBridge());
