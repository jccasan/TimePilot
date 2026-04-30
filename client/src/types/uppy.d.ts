/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "@uppy/core" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface UppyFile<M = any, B = any> {
    id: string;
    name: string;
    type?: string;
    size: number;
    data: File | Blob;
    meta: Record<string, any>;
    [key: string]: any;
  }

  export interface UploadResult<M = any, B = any> {
    successful: UppyFile<M, B>[];
    failed: UppyFile<M, B>[];
    [key: string]: any;
  }

  export interface UppyOptions {
    restrictions?: {
      maxNumberOfFiles?: number;
      maxFileSize?: number;
      allowedFileTypes?: string[];
    };
    [key: string]: any;
  }

  class Uppy {
    constructor(opts?: UppyOptions);
    use(plugin: any, opts?: any): this;
    on(event: string, callback: (...args: any[]) => void): this;
    off(event: string, callback: (...args: any[]) => void): this;
    reset(): void;
    close(): void;
    [key: string]: any;
  }

  export default Uppy;
}

declare module "@uppy/react/dashboard-modal" {
  import { ComponentType } from "react";
  const DashboardModal: ComponentType<any>;
  export default DashboardModal;
}

declare module "@uppy/aws-s3" {
  const AwsS3: any;
  export default AwsS3;
}
