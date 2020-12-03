/**********************************************************************
 * Copyright (c) 2018-2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 ***********************************************************************/

import * as fs from 'fs-extra';

import { CheSideCarContentReader, PLUGIN_RPC_CONTEXT } from '../common/che-protocol';

import { RPCProtocol } from '@theia/plugin-ext/lib/common/rpc-protocol';
import { URI } from 'vscode-uri';

export class CheSideCarContentReaderImpl implements CheSideCarContentReader {
  constructor(rpc: RPCProtocol) {
    console.log('+++ plugin/che-sidecar-content-reader.ts:20 CheSideCarContentReaderImpl > constructor');
    const delegate = rpc.getProxy(PLUGIN_RPC_CONTEXT.CHE_SIDERCAR_CONTENT_READER_MAIN);
    const machineName = process.env.CHE_MACHINE_NAME;
    if (machineName) {
      console.log('+++ plugin/che-sidecar-content-reader.ts:24 register scheme');
      delegate.$registerContentReader(`file-sidecar-${machineName}`);
    }
  }

  async $read(uri: string, options?: { encoding?: string }): Promise<string | undefined> {
    const _uri = URI.parse(uri);
    if (fs.pathExistsSync(_uri.fsPath)) {
      return fs.readFileSync(_uri.fsPath, options).toString();
    }
  }
}
