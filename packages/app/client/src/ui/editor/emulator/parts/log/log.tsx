//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.
//
// Microsoft Bot Framework: http://botframework.com
//
// Bot Framework Emulator Github:
// https://github.com/Microsoft/BotFramwork-Emulator
//
// Copyright (c) Microsoft Corporation
// All rights reserved.
//
// MIT License:
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED ""AS IS"", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//

import * as React from 'react';

import * as ChatActions from '../../../../../data/action/chatActions';
import * as styles from './log.scss';
import store from '../../../../../data/store';
import { ExtensionManager, InspectorAPI } from '../../../../../extensions';
import { LogEntry, LogItem, LogLevel, SharedConstants } from '@bfemulator/app-shared';
import { CommandServiceImpl } from '../../../../../platform/commands/commandServiceImpl';
import { Subscription } from 'rxjs';

function number2(n: number) {
  return ('0' + n).slice(-2);
}

function timestamp(t: number) {
  let timestamp1 = new Date(t);
  let hours = number2(timestamp1.getHours());
  let minutes = number2(timestamp1.getMinutes());
  let seconds = number2(timestamp1.getSeconds());
  return `${hours}:${minutes}:${seconds}`;
}

function logLevelToClassName(level: LogLevel): string {
  switch (level) {
    case LogLevel.Debug:
      return styles.level1;
    case LogLevel.Info:
      return styles.level0;
    case LogLevel.Warn:
      return styles.level2;
    case LogLevel.Error:
      return styles.level3;
    default:
      return '';
  }
}

/** One of these will always be "nexted" to the selectedActivity$
 *  subscription when called from within the log
 */
export interface ActivitySelectionFromLog {
  /** Differentiates between just hovering an activity or clicking to inspect */
  clicked: boolean;
}

export interface LogProps {
  document: any;
}

export interface LogState {
  count: number;
}

export default class Log extends React.Component<LogProps, LogState> {
  public scrollMe: Element;
  public selectedActivitySubscription: Subscription;
  public selectedActivity: any;
  public currentlyInspectedActivity: any;

  constructor(props: LogProps, context: LogState) {
    super(props, context);
    this.state = {
      count: 0
    };
  }

  componentDidUpdate(): void {
    let { props, scrollMe, selectedActivitySubscription, state } = this;
    // set up selected activity subscription once it's available
    if (props.document && props.document.selectedActivity$ && !selectedActivitySubscription) {
      selectedActivitySubscription =
        props.document.selectedActivity$.subscribe(obj => {
          if (obj) {
            if (obj.activity) {
              // this activity came from webchat (activities from webchat are wrapped)
              // ex: { activity: { id: , from: , ... } }
              const { activity } = obj;
              this.selectedActivity = activity;
              this.currentlyInspectedActivity = activity;
            } else {
              // this activity came from the log (activities from the log are raw)
              // ex: { id: , from: , to: , ... }
              const activity = obj;
              this.selectedActivity = activity;
              const { fromLog = {} } = activity;
              // check if it was clicked or hovered
              const { clicked } = fromLog;
              if (clicked) {
                this.currentlyInspectedActivity = activity;
              }
            }
          }
        });
    }
    if (props.document.log.entries.length !== state.count) {
      scrollMe.scrollTop = scrollMe.scrollHeight;
      this.setState({
        count: props.document.log.entries.length
      });
    }
  }

  render() {
    let key = 0;
    return (
      <div className={ styles.log } ref={ ref => this.scrollMe = ref }>
        {
          this.props.document.log.entries.map(entry =>
            <LogEntryComponent key={ `entry-${key++}` } entry={ entry } document={ this.props.document }
              selectedActivity={ this.selectedActivity }
              currentlyInspectedActivity={ this.currentlyInspectedActivity }/>
          )
        }
      </div>
    );
  }
}

export interface LogEntryProps {
  document: any;
  entry: LogEntry;
  selectedActivity?: any;
  currentlyInspectedActivity?: any;
}

class LogEntryComponent extends React.Component<LogEntryProps> {
  /** Allows <LogEntry />'s to highlight themselves based on their <LogItem /> children */
  private inspectableObjects: { [id: string]: boolean };

  /** Sends obj to the inspector panel
   * @param obj Can be a conversation activity or network request
   */
  inspect(obj: {}) {
    const fromLog: ActivitySelectionFromLog = { clicked: true };
    this.props.document.selectedActivity$.next({ fromLog });
    store.dispatch(ChatActions.setInspectorObjects(this.props.document.documentId, obj));
  }

  /** Sends obj to the inspector panel and highlights the activity in Webchat
   *  (triggered by click in log)
   * @param obj Conversation activity to be highlighted in the WebChat control
   */
  inspectAndHighlightInWebchat(obj: any) {
    this.inspect(obj);
    if (obj.id) {
      const fromLog: ActivitySelectionFromLog = { clicked: true };
      this.props.document.selectedActivity$.next({ ...obj, fromLog });
    }
  }

  /** Highlights an activity in webchat (triggered by hover in log) */
  highlightInWebchat(obj: any) {
    if (obj.id) {
      const fromLog: ActivitySelectionFromLog = { clicked: false };
      this.props.document.selectedActivity$.next({ ...obj, fromLog });
    }
  }

  /** Removes an activity's highlighting in webchat */
  removeHighlightInWebchat(obj: any) {
    if (obj.id) {
      // re-highlight last-selected activity if possible
      const { currentlyInspectedActivity } = this.props;
      if (currentlyInspectedActivity && currentlyInspectedActivity.id) {
        const fromLog: ActivitySelectionFromLog = { clicked: true };
        this.props.document.selectedActivity$.next({
          ...currentlyInspectedActivity,
          fromLog
        });
      } else {
        const fromLog: ActivitySelectionFromLog = { clicked: false };
        this.props.document.selectedActivity$.next({ fromLog });
      }
    }
  }

  render() {
    // reset the inspectable objects lookup
    this.inspectableObjects = {};

    // render the timestamp and any items to be displayed within the entry;
    // any rendered inspectable items will add themselves to the inspectable objects lookup
    const innerJsx = (
      <>
        { this.renderTimestamp(this.props.entry.timestamp) }
        { this.props.entry.items.map((item, key) => this.renderItem(item, '' + key)) }
      </>
    );

    // if the currently selected activity matches any of this item's inner inspectable
    // objects, append an 'inspected' classname to the log entry to highlight it
    const { currentlyInspectedActivity } = this.props;
    let inspectedActivityClass = '';
    if (currentlyInspectedActivity && currentlyInspectedActivity.id) {
      if (this.inspectableObjects[currentlyInspectedActivity.id]) {
        inspectedActivityClass = styles.inspected;
      }
    }

    return (
      <div key="entry" className={[styles.entry, inspectedActivityClass].join(' ')}>
        { innerJsx }
      </div>
    );
  }

  renderTimestamp(t: number) {
    return (
      <span key="timestamp" className={ styles.spaced }>
        [<span className={ styles.timestamp }>{ timestamp(t) }</span>]
      </span>
    );
  }

  renderItem(item: LogItem, key: string) {
    switch (item.type) {
      case 'text': {
        const { level, text } = item.payload;
        return this.renderTextItem(level, text, key);
      }
      case 'external-link': {
        const { text, hyperlink } = item.payload;
        return this.renderExternalLinkItem(text, hyperlink, key);
      }
      case 'open-app-settings': {
        const { text } = item.payload;
        return this.renderAppSettingsItem(text, key);
      }
      case 'exception': {
        const { err } = item.payload;
        return this.renderExceptionItem(err, key);
      }
      case 'inspectable-object': {
        const { obj } = item.payload;
        return this.renderInspectableItem(obj, key);
      }
      case 'network-request': {
        const { facility, body, headers, method, url } = item.payload;
        return this.renderNetworkRequestItem(facility, body, headers, method, url, key);
      }
      case 'network-response': {
        const { body, headers, statusCode, statusMessage, srcUrl } = item.payload;
        return this.renderNetworkResponseItem(body, headers, statusCode, statusMessage, srcUrl, key);
      }
      default:
        return false;
    }
  }

  renderTextItem(level: LogLevel, text: string, key: string) {
    return (
      <span key={ key } className={ `${styles.spaced} ${logLevelToClassName(level)}` }>
        { text }
      </span>
    );
  }

  renderExternalLinkItem(text: string, hyperlink: string, key: string) {
    return (
      <span key={ key } className={ styles.spaced }>
        <a onClick={ () => window.open(hyperlink, '_blank') }>{ text }</a>
      </span>
    );
  }

  renderAppSettingsItem(text: string, key: string) {
    const { Commands } = SharedConstants;
    return (
      <span key={ key } className={ styles.spaced }>
        <a onClick={ () => CommandServiceImpl.call(Commands.UI.ShowAppSettings) }>{ text }</a>
      </span>
    );
  }

  renderExceptionItem(err: Error, key: string) {
    return (
      <span key={ key } className={ `${styles.spaced} ${styles.level3}` }>
        { err && err.message ? err.message : '' }
      </span>
    );
  }

  renderInspectableItem(obj: any, key: string) {
    // add self to inspectable object lookup
    if (obj.id) {
      this.inspectableObjects[obj.id] = true;
    }

    let title = 'inspect';
    if (typeof obj.type === 'string') {
      title = obj.type;
    }
    let summaryText = this.summaryText(obj) || '';
    return (
      <span key={ key }
            onMouseOver={ () => this.highlightInWebchat(obj) }
            onMouseLeave={ () => this.removeHighlightInWebchat(obj) }>
        <span className={ `${styles.spaced} ${styles.level0}` }>
          <a onClick={ () => this.inspectAndHighlightInWebchat(obj) }>{ title }</a>
        </span>
        <span className={ `${styles.spaced} ${styles.level0}` }>
          { summaryText }
        </span>
      </span>
    );
  }

  renderNetworkRequestItem(_facility: any, body: any, _headers: any, method: any, _url: string, key: string) {
    let obj;
    if (typeof body === 'string') {
      try {
        obj = JSON.parse(body);
      } catch (e) {
        obj = body;
      }
    } else {
      obj = body;
    }
    if (obj) {
      return (
        <span key={ key } className={ `${styles.spaced} ${styles.level0}` }>
          <a onClick={ () => this.inspect(obj) }>{ method }</a>
        </span>
      );
    } else {
      return (
        <span key={ key } className={ `${styles.spaced} ${styles.level0}` }>
          { method }
        </span>
      );
    }
  }

  renderNetworkResponseItem(body: any, _headers: any, statusCode: number,
                            _statusMessage: string, _srcUrl: string, key: string) {
    let obj;
    if (typeof body === 'string') {
      try {
        obj = JSON.parse(body);
      } catch (e) {
        obj = body;
      }
    } else {
      obj = body;
    }
    if (obj) {
      return (
        <span key={ key } className={ `${styles.spaced} ${styles.level0}` }>
          <a onClick={ () => this.inspect(obj) }>{ statusCode }</a>
        </span>
      );
    } else {
      return (
        <span key={ key } className={ `${styles.spaced} ${styles.level0}` }>
          { statusCode }
        </span>
      );
    }
  }

  summaryText(obj: any): string {
    const inspResult = ExtensionManager.inspectorForObject(obj, true);
    if (inspResult && inspResult.inspector) {
      return InspectorAPI.summaryText(inspResult.inspector, obj);
    } else {
      return undefined;
    }
  }
}
