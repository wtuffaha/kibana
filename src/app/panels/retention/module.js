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
  'kbn',

  'jquery.flot',
  'jquery.flot.pie'
], function (angular, app, _, $, kbn) {
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
      /** @scratch /panels/retention/3
       *
       * === Parameters
       *
       * arrangement:: The arrangement of the legend. horizontal or vertical
       */
      arrangement : 'horizontal',
      /** @scratch /panels/retention/3
       * chart:: bar, pie or none
       */
      chart       : 'bar',
      /** @scratch /panels/retention/3
       * counter_pos:: The position of the legend, above or below
       */
      counter_pos : 'above',
      /** @scratch /panels/retention/3
       * donut:: If the chart is set to pie, setting donut to true will draw a hole in the midle of it
       */
      labels  : true,
      /** @scratch /panels/retention/3
       * spyable:: Setting spyable to false disables the inspect icon.
       */
      spyable : true,
      /** @scratch /panels/retention/5
       *
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
      $scope.hits = 0;

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
                           .interval('1d');

      _.each(queries, function(q) {
        // Exclude the time filters.
        var _q = $scope.ejs.FilteredQuery(
          querySrv.toEjsObj(q),
          filterSrv.getBoolFilter(filterSrv.idsByType('querystring')));

        var filterAgg = $scope.ejs.FilterAggregation('query_' + q.id)
                                  .filter($scope.ejs.QueryFilter(_q));
        var termsAgg = $scope.ejs.TermsAggregation('uniqs').field('user.uid').size(0);

        dateAgg.agg(filterAgg.agg(termsAgg));
      });

      request.agg(dateAgg).size(1);

      // Populate the inspector panel
      $scope.inspector = request.toJSON();

      // Then run it
      var results = $scope.ejs.doSearch(dashboard.indices, request);
      var numQueries = queries.length;

      // Populate scope when we have results
      results.then(function(results) {
        $scope.panelMeta.loading = false;
        if(_segment === 0) {
          $scope.hits = 0;
          $scope.data = [];
          query_id = $scope.query_id = new Date().getTime();
        }

        // Check for error and abort if found
        if(!(_.isUndefined(results.error))) {
          $scope.panel.error = $scope.parse_error(results.error);
          return;
        }

        // Make sure we're still on the same query/queries
        if($scope.query_id === query_id) {
          var days = results.aggregations.by_day.buckets;
          var res = _.map(days, function (d, i) {
            var q1 = _.pluck(d.query_0.uniqs.buckets, 'key');
            var q1h = {};
            for (var xi = 0; xi < q1.length; xi++) { q1h[q1[xi]] = true; }
            return _.map(_.range(i, days.length), function (x) {
              var q2 = _.pluck(days[x][numQueries === 1 ? 'query_0' : 'query_1'].uniqs.buckets, 'key');
              var c = 0;
              for (i = 0; i < q2.length; i++) { if (q1h[q2[i]]) { c++; } }
              var perc = c / q1.length * 100;

              var q1_text = "<strong style='color:" + queries[0].color + ";'>" +
                  (queries[0].alias.length ? queries[0].alias : queries[0].query) + "</strong>";

              var q2_text = q1_text;
              if (queries.length > 1) {
                q2_text = "<strong style='color:" + queries[1].color + ";'>" +
                  (queries[1].alias.length ? queries[1].alias : queries[1].query) + "</strong>";
              }

              var help_text = [
                "<strong style='font-size: 20px;'>" + perc.toString().slice(0, 4) + '%' + "</strong>",
                "of those who", q1_text, "(" + q1.length + ")", "<br /> on", d.key_as_string,
                "did", q2_text, "<br /> on", days[x].key_as_string
              ].join(' ');

              return {
                perc: perc,
                help_text: help_text
              };
            });
          });

          $scope.data = {
            queries: queries,
            rows: res,
            dates: _.pluck(days, 'key')
          };

          $scope.$emit('render');

          _.defer(function () {
            $('.retention-tile').tooltip({html: true});
          });
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
