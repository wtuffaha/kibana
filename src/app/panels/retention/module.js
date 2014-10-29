/** @scratch /panels/5
 *
 * include::panels/retention.asciidoc[]
 */

/** @scratch /panels/retention/0
 *
 * == Hits
 * Status: *Stable*
 *
 * The retention panel displays the number of retention for each of the queries on the dashboard in a
 * configurable format specified by the `chart' property.
 *
 */
define([
  'angular',
  'app',
  'lodash',
  'jquery',
], function (angular, app, _, $) {
  'use strict';

  var module = angular.module('kibana.panels.retention', []);
  app.useModule(module);

  module.controller('retention', function($scope, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      status  : "Stable",
      description : "Retention!"
    };

    // Set and populate defaults
    var _d = {
      style   : { "font-size": '10pt'},
      time_field : '@timestamp',
      spyable : true,
      absolutes : false,
      intervals : ['hour', 'day','week','month'],
      interval : 'day',
      field    : 'user.uid',
      min_perc : 0,
      max_perc : 100,
      /** 
       * ==== Queries
       * queries object:: This object describes the queries to use on this panel.
       * queries.mode::: Of the queries available, which to use. Options: +all, pinned, unpinned, selected+
       * queries.ids::: In +selected+ mode, which query ids are selected.
       */
      queries     : {
        mode        : 'all',
        ids         : []
      },
    };
    _.defaults($scope.panel,_d);

    $scope.init = function () {
      $scope.$on('refresh',function(){
        $scope.get_data();
      });
      $scope.get_data();
    };

    $scope.get_data = function(segment,query_id) {
      delete $scope.panel.error;
      $scope.panelMeta.loading = true;

      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }

      var _segment = _.isUndefined(segment) ? 0 : segment;
      var request = $scope.ejs.Request();

      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
      var queries = querySrv.getQueryObjs($scope.panel.queries.ids);

      if (queries.length > 2) {
        $scope.panel.error = "Must provide max 2 queries!";
        return;
      }

      var dateAgg = $scope.ejs.DateHistogramAggregation('by_day')
                           .field('@timestamp')
                           .interval($scope.panel.interval);

      _.each(queries, function(q) {
        // Exclude the time filters.
        var _q = $scope.ejs.FilteredQuery(
          querySrv.toEjsObj(q),
          filterSrv.getBoolFilter(filterSrv.idsByType('querystring')));

        var filterAgg = $scope.ejs.FilterAggregation('query_' + q.id)
                                  .filter($scope.ejs.QueryFilter(_q));
        var termsAgg = $scope.ejs.TermsAggregation('uniqs').field($scope.panel.field).size(0);

        dateAgg.agg(filterAgg.agg(termsAgg));
      });

      request.agg(dateAgg).size(1);

      // Populate the inspector panel
      $scope.inspector = request.toJSON();

      // Populate scope when we have results
      $.ajax({
        url: '/retention',
        type: 'POST',
        data: {indices: dashboard.indices, query: JSON.stringify(request.toJSON())},
        dataType: 'json',
        success: function (results) {
          $scope.panelMeta.loading = false;
          if(_segment === 0) {
            $scope.hits = 0;
            $scope.data = [];
            query_id = $scope.query_id = new Date().getTime();
          }

          // Make sure we're still on the same query/queries
          if($scope.query_id === query_id) {
            var res = _.map(results, function (row) {
              return _.map(row, function (day) {
                return _.extend({}, day, {
                  perc: day.intersection / day.q1_count * 100,
                });
              });
            });

            var q1_text = "<strong style='color:" + queries[0].color + ";'>" +
                (queries[0].alias.length ? queries[0].alias : queries[0].query) + "</strong>";

            var q2_text = q1_text;
            if (queries.length > 1) {
              q2_text = "<strong style='color:" + queries[1].color + ";'>" +
                (queries[1].alias.length ? queries[1].alias : queries[1].query) + "</strong>";
            }

            $scope.data = {
              q1_text: q1_text,
              q2_text: q2_text,
              queries: queries,
              rows: res,
              max: _.max(_.pluck(_.flatten(res), 'intersection'))
            };

            $scope.$emit('render');
            $scope.ejs.doSearch(dashboard.indices, $scope.ejs.Request()).then(function () {
              $('.retention-tile').tooltip({html: true});
            });
          }
        }
      });
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh =  false;
      $scope.$emit('render');
    };
  });
});
