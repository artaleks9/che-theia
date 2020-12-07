/**********************************************************************
 * Copyright (c) 2018-2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 ***********************************************************************/
import { CheSideCarFileSystem, FileTypeMain, PLUGIN_RPC_CONTEXT } from '../common/che-protocol';
import { Stats, lstat, readFile, stat } from 'fs';

import { RPCProtocol } from '@theia/plugin-ext/lib/common/rpc-protocol';
import { URI } from 'vscode-uri';
import { promisify } from 'util';

export namespace SideCarFileSystemProvider {
  export interface StatAndLink {
    // The stats of the file. If the file is a symbolic
    // link, the stats will be of that target file and
    // not the link itself.
    // If the file is a symbolic link pointing to a non
    // existing file, the stat will be of the link and
    // the `dangling` flag will indicate this.
    stat: Stats;

    // Will be provided if the resource is a symbolic link
    // on disk. Use the `dangling` flag to find out if it
    // points to a resource that does not exist on disk.
    symbolicLink?: { dangling: boolean };
  }
}

export enum FileSystemProviderErrorCode {
  FileExists = 'EntryExists',
  FileNotFound = 'EntryNotFound',
  FileNotADirectory = 'EntryNotADirectory',
  FileIsADirectory = 'EntryIsADirectory',
  FileExceedsMemoryLimit = 'EntryExceedsMemoryLimit',
  FileTooLarge = 'EntryTooLarge',
  NoPermissions = 'NoPermissions',
  Unavailable = 'Unavailable',
  Unknown = 'Unknown',
}

export class FileSystemProviderError extends Error {
  constructor(message: string, public readonly code: FileSystemProviderErrorCode) {
    super(message);
    Object.setPrototypeOf(this, FileSystemProviderError.prototype);
  }
}

export function markAsFileSystemProviderError(error: Error, code: FileSystemProviderErrorCode): Error {
  error.name = code ? `${code} (FileSystemError)` : 'FileSystemError';

  return error;
}

export function createFileSystemProviderError(
  error: Error | string,
  code: FileSystemProviderErrorCode
): FileSystemProviderError {
  const providerError = new FileSystemProviderError(error.toString(), code);
  markAsFileSystemProviderError(providerError, code);

  return providerError;
}

export class CheSideCarFileSystemImpl implements CheSideCarFileSystem {
  constructor(rpc: RPCProtocol) {
    console.log('+++ plugin/che-sidecar-file-system.ts:54 CheSideCarFileSystemImpl > construct');
    const delegate = rpc.getProxy(PLUGIN_RPC_CONTEXT.CHE_SIDECAR_FILE_SYSTEM_MAIN);
    const machineName = process.env.CHE_MACHINE_NAME;
    if (machineName) {
      console.log('+++ plugin/che-sidecar-file-system.ts:58 register scheme');
      delegate.$registerFileSystemProvider(`file-sidecar-${machineName}`);
    }
  }

  async $stat(resource: string): Promise<{ type: FileTypeMain; mtime: number; ctime: number; size: number }> {
    try {
      const { stat, symbolicLink } = await this.statLink(resource); // cannot use fs.stat() here to support links properly

      return {
        type: this.toType(stat, symbolicLink),
        ctime: stat.birthtime.getTime(), // intentionally not using ctime here, we want the creation time
        mtime: stat.mtime.getTime(),
        size: stat.size,
      };
    } catch (error) {
      throw this.toFileSystemProviderError(error);
    }
  }

  protected async statLink(path: string): Promise<SideCarFileSystemProvider.StatAndLink> {
    // First stat the link
    let lstats: Stats | undefined;
    try {
      lstats = await promisify(lstat)(path);

      // Return early if the stat is not a symbolic link at all
      if (!lstats.isSymbolicLink()) {
        return { stat: lstats };
      }
    } catch (error) {
      /* ignore - use stat() instead */
    }

    // If the stat is a symbolic link or failed to stat, use fs.stat()
    // which for symbolic links will stat the target they point to
    try {
      const stats = await promisify(stat)(path);

      return { stat: stats, symbolicLink: lstats?.isSymbolicLink() ? { dangling: false } : undefined };
    } catch (error) {
      // If the link points to a non-existing file we still want
      // to return it as result while setting dangling: true flag
      if (error.code === 'ENOENT' && lstats) {
        return { stat: lstats, symbolicLink: { dangling: true } };
      }

      throw error;
    }
  }

  private toType(entry: Stats, symbolicLink?: { dangling: boolean }): FileTypeMain {
    // Signal file type by checking for file / directory, except:
    // - symbolic links pointing to non-existing files are FileType.Unknown
    // - files that are neither file nor directory are FileType.Unknown
    let type: FileTypeMain;
    if (symbolicLink?.dangling) {
      type = FileTypeMain.Unknown;
    } else if (entry.isFile()) {
      type = FileTypeMain.File;
    } else if (entry.isDirectory()) {
      type = FileTypeMain.Directory;
    } else {
      type = FileTypeMain.Unknown;
    }

    // Always signal symbolic link as file type additionally
    if (symbolicLink) {
      type |= FileTypeMain.SymbolicLink;
    }

    return type;
  }

  $delete(resource: string, opts: { recursive: boolean; useTrash: boolean }): Promise<void> {
    return Promise.reject('Not implemented.');
  }

  $mkdir(resource: string): Promise<void> {
    return Promise.reject('Not implemented.');
  }

  async $readFile(resource: string): Promise<Uint8Array> {
    console.log('+++ plugin/che-sidecar-file-system.ts:72 $readFile for resource: ' + resource);
    const _uri = URI.parse(resource);
    console.log('+++ plugin/che-sidecar-file-system.ts:72 $readFile parsed _uri: ' + JSON.stringify(_uri));
    try {
      return await promisify(readFile)(_uri.fsPath);
    } catch (error) {
      return Promise.reject(this.toFileSystemProviderError(error));
    }
  }

  $readdir(resource: string): Promise<[string, string][]> {
    return Promise.reject('Not implemented.');
  }

  $rename(from: string, to: string, opts: { overwrite: boolean }): Promise<void> {
    return Promise.reject('Not implemented.');
  }

  $writeFile(resource: string, content: Uint8Array, opts: { overwrite: boolean; create: boolean }): Promise<void> {
    return Promise.reject('Not implemented.');
  }

  private toFileSystemProviderError(error: NodeJS.ErrnoException): FileSystemProviderError {
    if (error instanceof FileSystemProviderError) {
      return error; // avoid double conversion
    }

    let code: FileSystemProviderErrorCode;
    switch (error.code) {
      case 'ENOENT':
        code = FileSystemProviderErrorCode.FileNotFound;
        break;
      case 'EISDIR':
        code = FileSystemProviderErrorCode.FileIsADirectory;
        break;
      case 'ENOTDIR':
        code = FileSystemProviderErrorCode.FileNotADirectory;
        break;
      case 'EEXIST':
        code = FileSystemProviderErrorCode.FileExists;
        break;
      case 'EPERM':
      case 'EACCES':
        code = FileSystemProviderErrorCode.NoPermissions;
        break;
      default:
        code = FileSystemProviderErrorCode.Unknown;
    }

    return createFileSystemProviderError(error, code);
  }
}
